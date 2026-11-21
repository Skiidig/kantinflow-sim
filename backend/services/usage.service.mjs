import { createHash } from 'node:crypto';
import { Decimal128, MongoServerError, ObjectId } from 'mongodb';
import { ApiError } from '../api-error.mjs';
import {
  addDecimals,
  compareDecimals,
  negateDecimal,
  subDecimals,
  toDecimal128,
} from '../lib/decimal.mjs';
import {
  canonicalDecimal,
  decimalToString,
  isNonNegativeDecimalString,
  isPositiveDecimal,
  toLocalDateString,
} from '../lib/format.mjs';

const ZERO_DECIMAL = Decimal128.fromString('0');
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/iu;

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateUsage(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { body: 'Isi permintaan harus berupa objek JSON' };
  }

  const { itemId, quantity, note, usedOn } = body;
  const fields = {};

  if (typeof itemId !== 'string' || !OBJECT_ID_PATTERN.test(itemId)) {
    fields.itemId = 'Pilih barang yang valid';
  }
  if (!isNonNegativeDecimalString(quantity) || !/[1-9]/u.test(quantity)) {
    fields.quantity = 'Jumlah harus lebih dari 0';
  }
  if (note !== undefined && note !== null) {
    if (typeof note !== 'string') {
      fields.note = 'Catatan harus berupa teks';
    } else if (note.trim().length > 500) {
      fields.note = 'Catatan maksimal 500 karakter';
    }
  }
  if (usedOn !== undefined && usedOn !== null && usedOn !== '') {
    if (!isCalendarDate(usedOn)) {
      fields.usedOn = 'Tanggal pemakaian tidak valid (gunakan YYYY-MM-DD)';
    }
  }

  return fields;
}

export async function recordUsage({ client, db, actorId, key, body, today = toLocalDateString() }) {
  const itemId = new ObjectId(body.itemId);
  const requestedQty = canonicalDecimal(body.quantity);
  const effectiveDate = typeof body.usedOn === 'string' && body.usedOn ? body.usedOn : today;
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined;

  const canonicalPayload = {
    type: 'USAGE',
    itemId: itemId.toHexString(),
    quantity: requestedQty,
    usedOn: effectiveDate,
    note: note ?? null,
  };
  const requestHash = createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
  const identity = key ? { actorId, idempotencyKey: key } : null;

  const transactions = db.collection('stockTransactions');
  const batches = db.collection('batches');
  const items = db.collection('items');

  function replay(previous) {
    if (previous.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
    return { status: 200, data: previous.result };
  }

  try {
    return await client.withSession((session) => session.withTransaction(async () => {
      if (identity) {
        const previous = await transactions.findOne(identity, { session });
        if (previous) return replay(previous);
      }

      // Kunci item dengan stockRevision agar pemakaian FEFO dan penerimaan ter-serialisasi.
      const item = await items.findOneAndUpdate(
        { _id: itemId },
        { $inc: { stockRevision: 1 } },
        { session },
      );
      if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND');
      if (item.isActive === false) throw new ApiError(409, 'ITEM_INACTIVE');

      const fraction = requestedQty.split('.')[1] ?? '';
      if (fraction.length > (item.quantityScale ?? 0)) {
        throw new ApiError(400, 'VALIDATION_ERROR', {
          quantity: 'Jumlah tidak sesuai ketelitian satuan barang',
        });
      }

      // Ambil hanya batch layak (remainingQuantity > 0 dan belum kedaluwarsa), urut FEFO (expiresOn asc).
      const usableBatches = await batches
        .find(
          {
            itemId,
            remainingQuantity: { $gt: ZERO_DECIMAL },
            expiresOn: { $gte: effectiveDate },
          },
          { session },
        )
        .sort({ expiresOn: 1, receivedOn: 1, _id: 1 })
        .toArray();

      let totalUsable = '0';
      for (const batch of usableBatches) {
        totalUsable = addDecimals(totalUsable, decimalToString(batch.remainingQuantity));
      }

      if (compareDecimals(totalUsable, requestedQty) < 0) {
        throw new ApiError(409, 'INSUFFICIENT_USABLE_STOCK');
      }

      let remainingToAllocate = requestedQty;
      const lines = [];
      const allocations = [];

      for (const batch of usableBatches) {
        if (!isPositiveDecimal(remainingToAllocate)) break;

        const available = decimalToString(batch.remainingQuantity);
        const take = compareDecimals(available, remainingToAllocate) <= 0
          ? available
          : remainingToAllocate;
        const nextRemaining = subDecimals(available, take);

        await batches.updateOne(
          { _id: batch._id },
          { $set: { remainingQuantity: toDecimal128(nextRemaining) } },
          { session },
        );

        lines.push({
          batchId: batch._id,
          quantityDelta: toDecimal128(negateDecimal(take)),
          unitCostSnapshot: batch.unitCost ?? ZERO_DECIMAL,
        });
        allocations.push({
          batchId: batch._id.toHexString(),
          batchCode: batch.batchCode ?? null,
          expiresOn: batch.expiresOn,
          quantityUsed: take,
          remainingQuantity: nextRemaining,
        });

        remainingToAllocate = subDecimals(remainingToAllocate, take);
      }

      const [stockTotals] = await batches.aggregate([
        { $match: { itemId } },
        {
          $group: {
            _id: null,
            physicalStock: { $sum: '$remainingQuantity' },
            usableStock: {
              $sum: {
                $cond: [{ $gte: ['$expiresOn', effectiveDate] }, '$remainingQuantity', ZERO_DECIMAL],
              },
            },
          },
        },
      ], { session }).toArray();

      const recordedAt = new Date();
      const transactionId = new ObjectId();
      const data = {
        transactionId: transactionId.toHexString(),
        itemId: itemId.toHexString(),
        quantity: requestedQty,
        unit: item.baseUnit,
        usedOn: effectiveDate,
        ...(note ? { note } : {}),
        allocations,
        physicalStock: decimalToString(stockTotals?.physicalStock ?? ZERO_DECIMAL),
        usableStock: decimalToString(stockTotals?.usableStock ?? ZERO_DECIMAL),
      };

      const txDoc = {
        _id: transactionId,
        itemId,
        actorId,
        type: 'USAGE',
        usedOn: effectiveDate,
        recordedAt,
        lines,
      };
      if (note) txDoc.note = note;
      if (identity) {
        txDoc.idempotencyKey = key;
        txDoc.requestHash = requestHash;
        txDoc.result = data;
      }

      await transactions.insertOne(txDoc, { session });
      return { status: 201, data };
    }));
  } catch (err) {
    if (!identity || !(err instanceof MongoServerError) || err.code !== 11000) throw err;
    const previous = await transactions.findOne(identity);
    if (!previous) throw err;
    return replay(previous);
  }
}
