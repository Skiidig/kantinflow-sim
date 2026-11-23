import { ObjectId } from 'mongodb';
import { ApiError } from '../api-error.mjs';
import { absDecimal, addDecimals, mulDecimals } from '../lib/decimal.mjs';
import {
  decimalToString,
  endOfOperationalDay,
  startOfOperationalDay,
} from '../lib/format.mjs';
import { ROLES } from '../middleware/auth.mjs';

const VALID_TYPES = new Set(['RECEIPT', 'USAGE', 'DISPOSAL']);
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/iu;

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export async function listTransactions(db, query, { role }) {
  const fields = {};
  const match = {};

  if (typeof query.itemId === 'string' && query.itemId.trim() !== '') {
    const raw = query.itemId.trim();
    if (!OBJECT_ID_PATTERN.test(raw)) {
      fields.itemId = 'ID barang tidak valid';
    } else {
      match.itemId = new ObjectId(raw);
    }
  }

  if (typeof query.type === 'string' && query.type.trim() !== '') {
    const normalized = query.type.trim().toUpperCase();
    if (!VALID_TYPES.has(normalized)) {
      fields.type = 'Jenis transaksi harus RECEIPT, USAGE, atau DISPOSAL';
    } else {
      match.type = normalized;
    }
  }

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

  const page = query.page === undefined || query.page === '' ? 1 : Number(query.page);
  const limit = query.limit === undefined || query.limit === '' ? 20 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) {
    fields.page = 'Halaman harus bilangan bulat minimal 1';
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    fields.limit = 'Batas per halaman harus antara 1 dan 100';
  }

  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', fields);
  }

  if (from || to) {
    match.recordedAt = {};
    if (from) match.recordedAt.$gte = startOfOperationalDay(from);
    if (to) match.recordedAt.$lte = endOfOperationalDay(to);
  }

  const transactions = db.collection('stockTransactions');
  const [total, docs] = await Promise.all([
    transactions.countDocuments(match),
    transactions
      .find(match)
      .sort({ recordedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
  ]);

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
    itemIds.length
      ? db.collection('items').find({ _id: { $in: itemIds } }).toArray()
      : [],
    actorIds.length
      ? db.collection('users').find({ _id: { $in: actorIds } }, { projection: { passwordHash: 0 } }).toArray()
      : [],
    batchIds.length
      ? db.collection('batches').find({ _id: { $in: batchIds } }).toArray()
      : [],
  ]);

  const itemMap = new Map(itemDocs.map((doc) => [doc._id.toHexString(), doc]));
  const actorMap = new Map(actorDocs.map((doc) => [doc._id.toHexString(), doc]));
  const batchMap = new Map(batchDocs.map((doc) => [doc._id.toHexString(), doc]));
  const isAdmin = role === ROLES.ADMIN;

  const data = docs.map((doc) => {
    const item = doc.itemId ? itemMap.get(doc.itemId.toHexString()) : null;
    const actor = doc.actorId ? actorMap.get(doc.actorId.toHexString()) : null;

    let totalQuantity = '0';
    let totalCost = '0';

    const lines = (doc.lines ?? []).map((line) => {
      const batchIdHex = line.batchId?.toHexString() ?? null;
      const batch = batchIdHex ? batchMap.get(batchIdHex) : null;
      const deltaStr = line.quantityDelta ? line.quantityDelta.toString() : '0';
      const qtyAbs = absDecimal(deltaStr);
      totalQuantity = addDecimals(totalQuantity, qtyAbs);

      const serializedLine = {
        batchId: batchIdHex,
        batchCode: batch?.batchCode ?? null,
        expiresOn: batch?.expiresOn ?? null,
        quantityDelta: deltaStr.startsWith('-') ? `-${qtyAbs}` : qtyAbs,
      };

      if (isAdmin) {
        const unitCost = decimalToString(line.unitCostSnapshot ?? batch?.unitCost ?? '0');
        const lineCost = mulDecimals(qtyAbs, unitCost);
        totalCost = addDecimals(totalCost, lineCost);
        serializedLine.unitCost = unitCost;
        serializedLine.lineCost = lineCost;
      }

      return serializedLine;
    });

    const record = {
      id: doc._id.toHexString(),
      type: doc.type,
      recordedAt: doc.recordedAt ?? null,
      itemId: doc.itemId?.toHexString() ?? null,
      item: item
        ? {
            id: item._id.toHexString(),
            code: item.code ?? null,
            name: item.name,
            baseUnit: item.baseUnit,
          }
        : null,
      actorId: doc.actorId?.toHexString() ?? null,
      actor: actor
        ? {
            id: actor._id.toHexString(),
            name: actor.name ?? null,
            email: actor.email,
            role: actor.role,
          }
        : null,
      totalQuantity,
      lines,
    };

    if (doc.reason !== undefined) record.reason = doc.reason;
    if (doc.note !== undefined) record.note = doc.note;
    if (doc.usedOn !== undefined) record.usedOn = doc.usedOn;
    if (isAdmin) {
      record.totalCost = totalCost;
    }

    return record;
  });

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    data,
    meta: { page, limit, total, totalPages },
  };
}
