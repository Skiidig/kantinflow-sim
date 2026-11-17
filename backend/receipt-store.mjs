import { createHash } from 'node:crypto';
import { Decimal128, MongoServerError, ObjectId } from 'mongodb';
import { ApiError } from './api-error.mjs';

export async function prepareReceiptStore(db) {
  await db.collection('stockTransactions').createIndex(
    { actorId: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
  );
}

function canonicalDecimal(value) {
  const [integer, fraction = ''] = value.split('.');
  const whole = integer.replace(/^0+(?=\d)/, '');
  const decimals = fraction.replace(/0+$/, '');
  return decimals ? whole + '.' + decimals : whole;
}

function asDecimal(value, field) {
  try {
    return Decimal128.fromString(value);
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', { [field]: 'Angka di luar batas yang didukung' });
  }
}

export async function saveReceipt({ client, db, actorId, key, body }) {
  const itemId = new ObjectId(body.itemId);
  const receipt = {
    itemId: itemId.toHexString(),
    batchCode: body.batchCode.trim(),
    quantity: canonicalDecimal(body.quantity),
    unitCost: canonicalDecimal(body.unitCost),
    receivedOn: body.receivedOn,
    expiresOn: body.expiresOn,
  };
  const requestHash = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  const identity = { actorId, idempotencyKey: key };
  const transactions = db.collection('stockTransactions');
  const batches = db.collection('batches');
  const items = db.collection('items');

  function replay(previous) {
    if (previous.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
    return { status: 200, data: previous.result };
  }

  try {
    return await client.withSession((session) => session.withTransaction(async () => {
      const previous = await transactions.findOne(identity, { session });
      if (previous) return replay(previous);

      // Serialize receipts for the same item so the returned balance includes prior commits.
      const item = await items.findOneAndUpdate(
        { _id: itemId }, { $inc: { stockRevision: 1 } }, { session },
      );
      if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND');
      if (item.isActive === false) throw new ApiError(409, 'ITEM_INACTIVE');
      const fraction = receipt.quantity.split('.')[1] ?? '';
      if (fraction.length > (item.quantityScale ?? 0)) {
        throw new ApiError(400, 'VALIDATION_ERROR', { quantity: 'Jumlah tidak sesuai ketelitian satuan barang' });
      }
      const quantity = asDecimal(receipt.quantity, 'quantity');
      const unitCost = asDecimal(receipt.unitCost, 'unitCost');
      const recordedAt = new Date();
      const { insertedId: batchId } = await batches.insertOne({
        itemId, batchCode: receipt.batchCode, receivedOn: receipt.receivedOn,
        expiresOn: receipt.expiresOn, unitCost, initialQuantity: quantity,
        remainingQuantity: quantity, recordedAt,
      }, { session });
      const [balance] = await batches.aggregate([
        { $match: { itemId } },
        { $group: { _id: null, total: { $sum: '$remainingQuantity' } } },
      ], { session }).toArray();

      const transactionId = new ObjectId();
      const data = {
        batchId: batchId.toHexString(), transactionId: transactionId.toHexString(),
        itemId: receipt.itemId, stockBalance: balance.total.toString(), unit: item.baseUnit,
      };
      await transactions.insertOne({
        _id: transactionId, itemId, ...identity, requestHash, result: data,
        type: 'RECEIPT', recordedAt,
        lines: [{ batchId, quantityDelta: quantity, unitCostSnapshot: unitCost }],
      }, { session });
      return { status: 201, data };
    }));
  } catch (err) {
    if (!(err instanceof MongoServerError) || err.code !== 11000) throw err;
    const previous = await transactions.findOne(identity);
    if (!previous) throw err;
    return replay(previous);
  }
}
