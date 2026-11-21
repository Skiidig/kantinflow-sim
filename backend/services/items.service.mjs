import { Decimal128, MongoServerError } from 'mongodb';
import { ApiError } from '../api-error.mjs';
import {
  addDaysToDateString,
  asDecimal128,
  canonicalDecimal,
  decimalToString,
  escapeRegex,
  isNonNegativeDecimalString,
  isPositiveDecimal,
  normalizeDecimalInput,
  parseObjectId,
  toLocalDateString,
} from '../lib/format.mjs';
import { ROLES } from '../middleware/auth.mjs';

const CODE_PATTERN = /^[A-Za-z0-9._-]+$/u;
const ZERO_DECIMAL = Decimal128.fromString('0');

function validateItemFields(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'VALIDATION_ERROR', { body: 'Isi permintaan harus berupa objek JSON' });
  }

  const fields = {};
  const parsed = {};

  if (!partial || 'code' in body) {
    if (typeof body.code !== 'string' || body.code.trim() === '') {
      fields.code = 'Kode barang wajib diisi';
    } else {
      const code = body.code.trim().toUpperCase();
      if (code.length > 64 || !CODE_PATTERN.test(code)) {
        fields.code = 'Kode barang hanya boleh berisi huruf, angka, titik, garis bawah, atau tanda hubung';
      } else {
        parsed.code = code;
      }
    }
  }

  if (!partial || 'name' in body) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      fields.name = 'Nama barang wajib diisi';
    } else if (body.name.trim().length > 120) {
      fields.name = 'Nama barang maksimal 120 karakter';
    } else {
      parsed.name = body.name.trim();
    }
  }

  if (!partial || 'baseUnit' in body) {
    if (typeof body.baseUnit !== 'string' || body.baseUnit.trim() === '') {
      fields.baseUnit = 'Satuan dasar wajib diisi';
    } else if (body.baseUnit.trim().length > 32) {
      fields.baseUnit = 'Satuan dasar maksimal 32 karakter';
    } else {
      parsed.baseUnit = body.baseUnit.trim();
    }
  }

  if (!partial || 'quantityScale' in body) {
    if (body.quantityScale === undefined && !partial) {
      parsed.quantityScale = 0;
    } else if (
      typeof body.quantityScale !== 'number'
      || !Number.isInteger(body.quantityScale)
      || body.quantityScale < 0
      || body.quantityScale > 4
    ) {
      fields.quantityScale = 'Ketelitian satuan harus bilangan bulat antara 0 dan 4';
    } else {
      parsed.quantityScale = body.quantityScale;
    }
  }

  if (!partial || 'minimumStock' in body) {
    const raw = normalizeDecimalInput(body.minimumStock);
    if (raw === null || !isNonNegativeDecimalString(raw)) {
      fields.minimumStock = 'Stok minimum harus berupa angka desimal yang tidak negatif';
    } else {
      const normalized = canonicalDecimal(raw);
      const fraction = normalized.split('.')[1] ?? '';
      if (fraction.length > 4) {
        fields.minimumStock = 'Stok minimum maksimal 4 angka di belakang koma';
      } else {
        parsed.minimumStock = asDecimal128(normalized, 'minimumStock');
      }
    }
  }

  if (partial && 'isActive' in body) {
    if (typeof body.isActive !== 'boolean') {
      fields.isActive = 'Status aktif harus berupa boolean';
    } else {
      parsed.isActive = body.isActive;
    }
  }

  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', fields);
  }
  if (partial && Object.keys(parsed).length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', { body: 'Minimal satu kolom yang valid harus diisi' });
  }

  return parsed;
}

function serializeItem(doc) {
  const minimumStock = decimalToString(doc.minimumStock ?? ZERO_DECIMAL);
  const physicalStock = decimalToString(doc.physicalStock ?? ZERO_DECIMAL);
  const usableStock = decimalToString(doc.usableStock ?? ZERO_DECIMAL);
  return {
    id: doc._id.toHexString(),
    code: doc.code ?? null,
    name: doc.name,
    baseUnit: doc.baseUnit,
    minimumStock,
    quantityScale: doc.quantityScale ?? 0,
    isActive: doc.isActive !== false,
    physicalStock,
    usableStock,
    isLowStock: Boolean(doc.isLowStock),
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

function buildStockEnrichmentStages(today) {
  return [
    {
      $lookup: {
        from: 'batches',
        let: { itemId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$itemId', '$$itemId'] } } },
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
        ],
        as: '_stock',
      },
    },
    {
      $addFields: {
        _minStock: { $ifNull: ['$minimumStock', ZERO_DECIMAL] },
        physicalStock: { $ifNull: [{ $arrayElemAt: ['$_stock.physicalStock', 0] }, ZERO_DECIMAL] },
        usableStock: { $ifNull: [{ $arrayElemAt: ['$_stock.usableStock', 0] }, ZERO_DECIMAL] },
      },
    },
    {
      $addFields: {
        isLowStock: {
          $and: [
            { $ne: ['$isActive', false] },
            { $lte: ['$usableStock', '$_minStock'] },
          ],
        },
      },
    },
    { $project: { _stock: 0, _minStock: 0 } },
  ];
}

async function getItemWithStock(db, itemId, today, session) {
  const [doc] = await db.collection('items').aggregate(
    [{ $match: { _id: itemId } }, ...buildStockEnrichmentStages(today)],
    session ? { session } : undefined,
  ).toArray();
  return doc ?? null;
}

export async function listItems(db, query, { today = toLocalDateString() } = {}) {
  const match = {};
  const q = typeof query.q === 'string' ? query.q.trim()
    : typeof query.search === 'string' ? query.search.trim() : '';

  if (q) {
    const regex = new RegExp(escapeRegex(q), 'iu');
    match.$or = [{ name: regex }, { code: regex }];
  }

  const statusParam = typeof query.status === 'string' ? query.status.trim().toLowerCase() : '';
  const isActiveParam = typeof query.isActive === 'string' ? query.isActive.trim().toLowerCase() : '';

  if (statusParam === 'active' || isActiveParam === 'true') {
    match.isActive = { $ne: false };
  } else if (statusParam === 'archived' || statusParam === 'inactive' || isActiveParam === 'false') {
    match.isActive = false;
  } else if (
    (statusParam && statusParam !== 'all')
    || (isActiveParam && isActiveParam !== 'all')
  ) {
    throw new ApiError(400, 'VALIDATION_ERROR', { status: 'Filter status tidak valid' });
  }

  if (typeof query.baseUnit === 'string' && query.baseUnit.trim() !== '') {
    match.baseUnit = new RegExp(`^${escapeRegex(query.baseUnit.trim())}$`, 'iu');
  }

  const lowStockParam = typeof query.lowStock === 'string' ? query.lowStock.trim().toLowerCase() : '';
  if (lowStockParam && lowStockParam !== 'true' && lowStockParam !== 'false') {
    throw new ApiError(400, 'VALIDATION_ERROR', { lowStock: 'Filter lowStock harus true atau false' });
  }

  const sortFieldMap = {
    name: 'name',
    code: 'code',
    createdAt: 'createdAt',
    minimumStock: 'minimumStock',
    physicalStock: 'physicalStock',
    usableStock: 'usableStock',
  };
  const requestedSortBy = typeof query.sortBy === 'string' && query.sortBy.trim()
    ? query.sortBy.trim()
    : (typeof query.sort === 'string' && query.sort.trim() ? query.sort.trim() : 'name');
  const sortField = sortFieldMap[requestedSortBy];
  if (!sortField) {
    throw new ApiError(400, 'VALIDATION_ERROR', { sortBy: 'Kolom pengurutan tidak didukung' });
  }

  const requestedOrder = typeof query.sortOrder === 'string' && query.sortOrder.trim()
    ? query.sortOrder.trim().toLowerCase()
    : (typeof query.order === 'string' && query.order.trim() ? query.order.trim().toLowerCase() : 'asc');
  if (requestedOrder !== 'asc' && requestedOrder !== 'desc') {
    throw new ApiError(400, 'VALIDATION_ERROR', { sortOrder: 'Urutan harus asc atau desc' });
  }
  const sortDir = requestedOrder === 'desc' ? -1 : 1;

  const page = query.page === undefined || query.page === '' ? 1 : Number(query.page);
  const limit = query.limit === undefined || query.limit === '' ? 20 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) {
    throw new ApiError(400, 'VALIDATION_ERROR', { page: 'Halaman harus bilangan bulat minimal 1' });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, 'VALIDATION_ERROR', { limit: 'Batas per halaman harus antara 1 dan 100' });
  }

  const pipeline = [
    { $match: match },
    ...buildStockEnrichmentStages(today),
  ];

  if (lowStockParam === 'true') {
    pipeline.push({ $match: { isLowStock: true } });
  } else if (lowStockParam === 'false') {
    pipeline.push({ $match: { isLowStock: false } });
  }

  pipeline.push(
    { $sort: { [sortField]: sortDir, _id: 1 } },
    {
      $facet: {
        items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        meta: [{ $count: 'total' }],
      },
    },
  );

  const [result] = await db.collection('items').aggregate(pipeline).toArray();
  const total = result?.meta?.[0]?.total ?? 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    data: (result?.items ?? []).map(serializeItem),
    meta: { page, limit, total, totalPages },
  };
}

export async function getItemById(db, id, { today = toLocalDateString() } = {}) {
  const itemId = parseObjectId(id, 'ITEM_NOT_FOUND');
  const doc = await getItemWithStock(db, itemId, today);
  if (!doc) throw new ApiError(404, 'ITEM_NOT_FOUND');
  return serializeItem(doc);
}

export async function createItem(db, body, { today = toLocalDateString() } = {}) {
  const parsed = validateItemFields(body, { partial: false });
  const items = db.collection('items');

  const existing = await items.findOne({ code: parsed.code }, { projection: { _id: 1 } });
  if (existing) {
    throw new ApiError(409, 'ITEM_CODE_EXISTS', { code: 'Kode barang sudah digunakan' });
  }

  const now = new Date();
  const doc = {
    code: parsed.code,
    name: parsed.name,
    baseUnit: parsed.baseUnit,
    minimumStock: parsed.minimumStock,
    quantityScale: parsed.quantityScale,
    isActive: true,
    stockRevision: 0,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const { insertedId } = await items.insertOne(doc);
    const created = await getItemWithStock(db, insertedId, today);
    return serializeItem(created);
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      throw new ApiError(409, 'ITEM_CODE_EXISTS', { code: 'Kode barang sudah digunakan' });
    }
    throw err;
  }
}

export async function updateItem({ client, db }, id, body, { today = toLocalDateString() } = {}) {
  const itemId = parseObjectId(id, 'ITEM_NOT_FOUND');
  const parsed = validateItemFields(body, { partial: true });
  const items = db.collection('items');
  const batches = db.collection('batches');

  try {
    return await client.withSession((session) => session.withTransaction(async () => {
      const current = await items.findOneAndUpdate(
        { _id: itemId },
        { $inc: { stockRevision: 1 } },
        { session, returnDocument: 'after' },
      );
      if (!current) throw new ApiError(404, 'ITEM_NOT_FOUND');

      if (parsed.isActive === false) {
        const [balance] = await batches.aggregate([
          { $match: { itemId } },
          { $group: { _id: null, total: { $sum: '$remainingQuantity' } } },
        ], { session }).toArray();
        if (balance && isPositiveDecimal(balance.total)) {
          throw new ApiError(409, 'ITEM_HAS_STOCK');
        }
      }

      if (parsed.code && parsed.code !== current.code) {
        const duplicate = await items.findOne(
          { code: parsed.code, _id: { $ne: itemId } },
          { session, projection: { _id: 1 } },
        );
        if (duplicate) {
          throw new ApiError(409, 'ITEM_CODE_EXISTS', { code: 'Kode barang sudah digunakan' });
        }
      }

      await items.updateOne(
        { _id: itemId },
        { $set: { ...parsed, updatedAt: new Date() } },
        { session },
      );

      const updated = await getItemWithStock(db, itemId, today, session);
      return serializeItem(updated);
    }));
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      throw new ApiError(409, 'ITEM_CODE_EXISTS', { code: 'Kode barang sudah digunakan' });
    }
    throw err;
  }
}

export async function deleteOrArchiveItem({ client, db }, id, { today = toLocalDateString() } = {}) {
  const itemId = parseObjectId(id, 'ITEM_NOT_FOUND');
  const items = db.collection('items');
  const batches = db.collection('batches');
  const transactions = db.collection('stockTransactions');

  return client.withSession((session) => session.withTransaction(async () => {
    const current = await items.findOneAndUpdate(
      { _id: itemId },
      { $inc: { stockRevision: 1 } },
      { session, returnDocument: 'after' },
    );
    if (!current) throw new ApiError(404, 'ITEM_NOT_FOUND');

    const [batchCount, txCount] = await Promise.all([
      batches.countDocuments({ itemId }, { session, limit: 1 }),
      transactions.countDocuments({ itemId }, { session, limit: 1 }),
    ]);

    if (batchCount === 0 && txCount === 0) {
      await items.deleteOne({ _id: itemId }, { session });
      return { status: 204 };
    }

    const [balance] = await batches.aggregate([
      { $match: { itemId } },
      { $group: { _id: null, total: { $sum: '$remainingQuantity' } } },
    ], { session }).toArray();

    if (balance && isPositiveDecimal(balance.total)) {
      throw new ApiError(409, 'ITEM_HAS_STOCK');
    }

    await items.updateOne(
      { _id: itemId },
      { $set: { isActive: false, updatedAt: new Date() } },
      { session },
    );
    const archived = await getItemWithStock(db, itemId, today, session);
    return {
      status: 200,
      data: {
        ...serializeItem(archived),
        action: 'ARCHIVED',
      },
    };
  }));
}

export async function listItemBatches(db, id, { role, onlyRemaining = false, today = toLocalDateString() } = {}) {
  const itemId = parseObjectId(id, 'ITEM_NOT_FOUND');
  const itemDoc = await getItemWithStock(db, itemId, today);
  if (!itemDoc) throw new ApiError(404, 'ITEM_NOT_FOUND');

  const filter = { itemId };
  if (onlyRemaining) {
    filter.remainingQuantity = { $gt: ZERO_DECIMAL };
  }

  const nearExpiryLimit = addDaysToDateString(today, 3);
  const docs = await db.collection('batches')
    .find(filter)
    .sort({ expiresOn: 1, receivedOn: 1, _id: 1 })
    .toArray();

  const batches = docs.map((batch) => {
    const remaining = decimalToString(batch.remainingQuantity);
    let status = 'LAYAK';
    if (!isPositiveDecimal(remaining)) {
      status = 'HABIS';
    } else if (batch.expiresOn < today) {
      status = 'KEDALUWARSA';
    } else if (batch.expiresOn <= nearExpiryLimit) {
      status = 'MENDEKATI_KEDALUWARSA';
    }

    const serialized = {
      id: batch._id.toHexString(),
      itemId: batch.itemId.toHexString(),
      batchCode: batch.batchCode ?? null,
      receivedOn: batch.receivedOn,
      expiresOn: batch.expiresOn,
      initialQuantity: decimalToString(batch.initialQuantity ?? batch.remainingQuantity),
      remainingQuantity: remaining,
      status,
      recordedAt: batch.recordedAt ?? null,
    };

    if (role === ROLES.ADMIN) {
      serialized.unitCost = decimalToString(batch.unitCost ?? ZERO_DECIMAL);
    }

    return serialized;
  });

  return {
    item: serializeItem(itemDoc),
    batches,
  };
}
