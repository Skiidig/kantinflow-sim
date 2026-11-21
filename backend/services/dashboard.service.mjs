import { Decimal128 } from 'mongodb';
import { addDaysToDateString, decimalToString, toLocalDateString } from '../lib/format.mjs';
import { ROLES } from '../middleware/auth.mjs';

const ZERO_DECIMAL = Decimal128.fromString('0');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function diffDays(fromDateStr, toDateStr) {
  const fromMs = Date.parse(`${fromDateStr}T00:00:00Z`);
  const toMs = Date.parse(`${toDateStr}T00:00:00Z`);
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

function serializeDashboardBatch(doc, { role, today, expired }) {
  const base = {
    id: doc._id.toHexString(),
    itemId: doc.itemId.toHexString(),
    itemCode: doc.item?.code ?? null,
    itemName: doc.item?.name ?? null,
    baseUnit: doc.item?.baseUnit ?? null,
    batchCode: doc.batchCode ?? null,
    receivedOn: doc.receivedOn,
    expiresOn: doc.expiresOn,
    remainingQuantity: decimalToString(doc.remainingQuantity),
  };
  if (expired) {
    base.daysOverdue = diffDays(doc.expiresOn, today);
  } else {
    base.daysUntilExpiry = diffDays(today, doc.expiresOn);
  }
  if (role === ROLES.ADMIN) {
    base.unitCost = decimalToString(doc.unitCost ?? ZERO_DECIMAL);
  }
  return base;
}

export async function getDashboardData(db, { role, days = 3, today = toLocalDateString() } = {}) {
  const nearExpiryLimit = addDaysToDateString(today, days);
  const items = db.collection('items');
  const batches = db.collection('batches');

  const batchLookupStages = [
    {
      $lookup: {
        from: 'items',
        localField: 'itemId',
        foreignField: '_id',
        as: '_item',
      },
    },
    { $addFields: { item: { $arrayElemAt: ['$_item', 0] } } },
    { $project: { _item: 0 } },
  ];

  const [totalActiveItems, lowStockDocs, expiringSoonDocs, expiredDocs] = await Promise.all([
    items.countDocuments({ isActive: { $ne: false } }),
    items.aggregate([
      { $match: { isActive: { $ne: false } } },
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
      { $match: { $expr: { $lte: ['$usableStock', '$_minStock'] } } },
      { $sort: { usableStock: 1, name: 1, _id: 1 } },
      { $project: { _stock: 0, _minStock: 0 } },
    ]).toArray(),
    batches.aggregate([
      {
        $match: {
          remainingQuantity: { $gt: ZERO_DECIMAL },
          expiresOn: { $gte: today, $lte: nearExpiryLimit },
        },
      },
      { $sort: { expiresOn: 1, receivedOn: 1, _id: 1 } },
      ...batchLookupStages,
    ]).toArray(),
    batches.aggregate([
      {
        $match: {
          remainingQuantity: { $gt: ZERO_DECIMAL },
          expiresOn: { $lt: today },
        },
      },
      { $sort: { expiresOn: 1, receivedOn: 1, _id: 1 } },
      ...batchLookupStages,
    ]).toArray(),
  ]);

  const lowStockItems = lowStockDocs.map((doc) => ({
    id: doc._id.toHexString(),
    code: doc.code ?? null,
    name: doc.name,
    baseUnit: doc.baseUnit,
    minimumStock: decimalToString(doc.minimumStock ?? ZERO_DECIMAL),
    physicalStock: decimalToString(doc.physicalStock ?? ZERO_DECIMAL),
    usableStock: decimalToString(doc.usableStock ?? ZERO_DECIMAL),
    isLowStock: true,
  }));

  const expiringSoonBatches = expiringSoonDocs.map((doc) =>
    serializeDashboardBatch(doc, { role, today, expired: false }),
  );
  const expiredBatches = expiredDocs.map((doc) =>
    serializeDashboardBatch(doc, { role, today, expired: true }),
  );

  return {
    summary: {
      asOfDate: today,
      nearExpiryThresholdDays: days,
      totalActiveItems,
      lowStockCount: lowStockItems.length,
      expiringSoonCount: expiringSoonBatches.length,
      expiredRemainingCount: expiredBatches.length,
    },
    lowStockItems,
    expiringSoonBatches,
    expiredBatches,
  };
}
