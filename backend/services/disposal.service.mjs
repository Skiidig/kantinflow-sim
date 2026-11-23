import { createHash } from 'node:crypto';
import { Decimal128, MongoServerError, ObjectId } from 'mongodb';
import { ApiError } from '../api-error.mjs';
import {
  absDecimal,
  addDecimals,
  compareDecimals,
  mulDecimals,
  negateDecimal,
  subDecimals,
  toDecimal128,
} from '../lib/decimal.mjs';
import {
  canonicalDecimal,
  decimalToString,
  endOfOperationalDay,
  isNonNegativeDecimalString,
  startOfOperationalDay,
  toLocalDateString,
} from '../lib/format.mjs';

const ZERO_DECIMAL = Decimal128.fromString('0');
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/iu;

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateDisposal(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { body: 'Isi permintaan harus berupa objek JSON' };
  }

  const { batchId, quantity, reason } = body;
  const fields = {};

  if (typeof batchId !== 'string' || !OBJECT_ID_PATTERN.test(batchId)) {
    fields.batchId = 'Pilih batch yang valid';
  }
  if (!isNonNegativeDecimalString(quantity) || !/[1-9]/u.test(quantity)) {
    fields.quantity = 'Jumlah harus lebih dari 0';
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    fields.reason = 'Alasan pembuangan wajib diisi';
  } else if (reason.trim().length > 300) {
    fields.reason = 'Alasan pembuangan maksimal 300 karakter';
  }

  return fields;
}

export async function recordDisposal({ client, db, actorId, key, body, today = toLocalDateString() }) {
  const batchId = new ObjectId(body.batchId);
  const requestedQty = canonicalDecimal(body.quantity);
  const reason = body.reason.trim();

  const canonicalPayload = {
    type: 'DISPOSAL',
    batchId: batchId.toHexString(),
    quantity: requestedQty,
    reason,
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

      const initialBatch = await batches.findOne({ _id: batchId }, { session });
      if (!initialBatch) throw new ApiError(404, 'BATCH_NOT_FOUND');

      // Kunci item induk untuk menyerialisasi perubahan stok pada item tersebut.
      const item = await items.findOneAndUpdate(
        { _id: initialBatch.itemId },
        { $inc: { stockRevision: 1 } },
        { session },
      );
      if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND');
      if (item.isActive === false) throw new ApiError(409, 'ITEM_INACTIVE');

      const batch = await batches.findOne({ _id: batchId }, { session });
      if (!batch) throw new ApiError(404, 'BATCH_NOT_FOUND');

      const fraction = requestedQty.split('.')[1] ?? '';
      if (fraction.length > (item.quantityScale ?? 0)) {
        throw new ApiError(400, 'VALIDATION_ERROR', {
          quantity: 'Jumlah tidak sesuai ketelitian satuan barang',
        });
      }

      const currentRemaining = decimalToString(batch.remainingQuantity);
      if (compareDecimals(requestedQty, currentRemaining) > 0) {
        throw new ApiError(409, 'INSUFFICIENT_BATCH_STOCK');
      }

      const nextRemaining = subDecimals(currentRemaining, requestedQty);
      await batches.updateOne(
        { _id: batch._id },
        { $set: { remainingQuantity: toDecimal128(nextRemaining) } },
        { session },
      );

      const [stockTotals] = await batches.aggregate([
        { $match: { itemId: item._id } },
        {
          $group: {
            _id: null,
            physicalStock: { $sum: '$remainingQuantity' },
            usableStock: {
              $sum: {
                $cond: [{ $gte: ['$expiresOn', today] }, '$remainingQuantity', ZERO_DECIMAL],
              },
            },
          },
        },
      ], { session }).toArray();

      const recordedAt = new Date();
      const transactionId = new ObjectId();
      const data = {
        transactionId: transactionId.toHexString(),
        itemId: item._id.toHexString(),
        batchId: batch._id.toHexString(),
        batchCode: batch.batchCode ?? null,
        quantity: requestedQty,
        unit: item.baseUnit,
        reason,
        batchRemainingQuantity: nextRemaining,
        physicalStock: decimalToString(stockTotals?.physicalStock ?? ZERO_DECIMAL),
        usableStock: decimalToString(stockTotals?.usableStock ?? ZERO_DECIMAL),
      };

      const txDoc = {
        _id: transactionId,
        itemId: item._id,
        actorId,
        type: 'DISPOSAL',
        reason,
        recordedAt,
        lines: [
          {
            batchId: batch._id,
            quantityDelta: toDecimal128(negateDecimal(requestedQty)),
            unitCostSnapshot: batch.unitCost ?? ZERO_DECIMAL,
          },
        ],
      };
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

export async function getDisposalReport(db, query) {
  const fields = {};
  const match = { type: 'DISPOSAL' };

  const from = typeof query.from === 'string' ? query.from.trim() : '';
  const to = typeof query.to === 'string' ? query.to.trim() : '';

  if (from && !isCalendarDate(from)) {
    fields.from = 'Tanggal awal tidak valid (gunakan YYYY-MM-DD)';
  }
  if (to && !isCalendarDate(to)) {
    fields.to = 'Tanggal akhir tidak valid (gunakan YYYY-MM-DD)';
  }
  if (from && to && !fields.from && !fields.to && from > to) {
    fields.to = 'Tanggal akhir tidak boleh mendahului tanggal awal';
  }

  if (typeof query.itemId === 'string' && query.itemId.trim() !== '') {
    const raw = query.itemId.trim();
    if (!OBJECT_ID_PATTERN.test(raw)) {
      fields.itemId = 'ID barang tidak valid';
    } else {
      match.itemId = new ObjectId(raw);
    }
  }

  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', fields);
  }

  if (from || to) {
    match.recordedAt = {};
    if (from) match.recordedAt.$gte = startOfOperationalDay(from);
    if (to) match.recordedAt.$lte = endOfOperationalDay(to);
  }

  const docs = await db.collection('stockTransactions')
    .find(match)
    .sort({ recordedAt: -1, _id: -1 })
    .toArray();

  const itemIds = [...new Set(docs.map((doc) => doc.itemId?.toHexString()).filter(Boolean))].map(
    (id) => new ObjectId(id),
  );
  const actorIds = [...new Set(docs.map((doc) => doc.actorId?.toHexString()).filter(Boolean))].map(
    (id) => new ObjectId(id),
  );
  const batchIds = [
    ...new Set(
      docs.flatMap((doc) => (doc.lines ?? []).map((line) => line.batchId?.toHexString())).filter(Boolean),
    ),
  ].map((id) => new ObjectId(id));

  const [itemDocs, actorDocs, batchDocs] = await Promise.all([
    itemIds.length ? db.collection('items').find({ _id: { $in: itemIds } }).toArray() : [],
    actorIds.length
      ? db.collection('users').find({ _id: { $in: actorIds } }, { projection: { passwordHash: 0 } }).toArray()
      : [],
    batchIds.length ? db.collection('batches').find({ _id: { $in: batchIds } }).toArray() : [],
  ]);

  const itemMap = new Map(itemDocs.map((doc) => [doc._id.toHexString(), doc]));
  const actorMap = new Map(actorDocs.map((doc) => [doc._id.toHexString(), doc]));
  const batchMap = new Map(batchDocs.map((doc) => [doc._id.toHexString(), doc]));

  let totalQuantity = '0';
  let totalCost = '0';
  const byItemMap = new Map();
  const byReasonMap = new Map();
  const disposals = [];

  for (const doc of docs) {
    const itemIdHex = doc.itemId?.toHexString() ?? null;
    const item = itemIdHex ? itemMap.get(itemIdHex) : null;
    const actor = doc.actorId ? actorMap.get(doc.actorId.toHexString()) : null;
    const reason = doc.reason ?? 'Tanpa alasan';

    for (const line of doc.lines ?? []) {
      const batchIdHex = line.batchId?.toHexString() ?? null;
      const batch = batchIdHex ? batchMap.get(batchIdHex) : null;
      const qty = absDecimal(line.quantityDelta ? line.quantityDelta.toString() : '0');
      const unitCost = decimalToString(line.unitCostSnapshot ?? batch?.unitCost ?? ZERO_DECIMAL);
      const lineCost = mulDecimals(qty, unitCost);

      totalQuantity = addDecimals(totalQuantity, qty);
      totalCost = addDecimals(totalCost, lineCost);

      const itemKey = itemIdHex ?? 'unknown';
      const itemEntry = byItemMap.get(itemKey) ?? {
        itemId: itemIdHex,
        itemCode: item?.code ?? null,
        itemName: item?.name ?? null,
        baseUnit: item?.baseUnit ?? null,
        totalQuantity: '0',
        totalCost: '0',
        eventCount: 0,
      };
      itemEntry.totalQuantity = addDecimals(itemEntry.totalQuantity, qty);
      itemEntry.totalCost = addDecimals(itemEntry.totalCost, lineCost);
      itemEntry.eventCount += 1;
      byItemMap.set(itemKey, itemEntry);

      const reasonEntry = byReasonMap.get(reason) ?? {
        reason,
        totalQuantity: '0',
        totalCost: '0',
        eventCount: 0,
      };
      reasonEntry.totalQuantity = addDecimals(reasonEntry.totalQuantity, qty);
      reasonEntry.totalCost = addDecimals(reasonEntry.totalCost, lineCost);
      reasonEntry.eventCount += 1;
      byReasonMap.set(reason, reasonEntry);

      disposals.push({
        transactionId: doc._id.toHexString(),
        recordedAt: doc.recordedAt ?? null,
        itemId: itemIdHex,
        itemCode: item?.code ?? null,
        itemName: item?.name ?? null,
        baseUnit: item?.baseUnit ?? null,
        batchId: batchIdHex,
        batchCode: batch?.batchCode ?? null,
        expiresOn: batch?.expiresOn ?? null,
        quantity: qty,
        unitCost,
        totalCost: lineCost,
        reason,
        actor: actor
          ? {
              id: actor._id.toHexString(),
              name: actor.name ?? null,
              email: actor.email,
            }
          : null,
      });
    }
  }

  const byItem = [...byItemMap.values()].sort((a, b) => compareDecimals(b.totalCost, a.totalCost));
  const byReason = [...byReasonMap.values()].sort((a, b) => compareDecimals(b.totalCost, a.totalCost));

  return {
    summary: {
      from: from || null,
      to: to || null,
      totalEvents: docs.length,
      totalQuantity,
      totalCost,
    },
    byItem,
    byReason,
    disposals,
  };
}
