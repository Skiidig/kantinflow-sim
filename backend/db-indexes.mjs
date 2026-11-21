import { prepareReceiptStore } from './receipt-store.mjs';

export async function prepareDatabase(db) {
  await prepareReceiptStore(db);

  await db.collection('users').createIndex(
    { email: 1 },
    { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
  );

  await db.collection('items').createIndex(
    { code: 1 },
    { unique: true, partialFilterExpression: { code: { $type: 'string' } } },
  );

  await db.collection('batches').createIndex({ itemId: 1, expiresOn: 1, receivedOn: 1 });
  await db.collection('batches').createIndex({ expiresOn: 1, remainingQuantity: 1 });
  await db.collection('stockTransactions').createIndex({ itemId: 1, recordedAt: -1 });
  await db.collection('stockTransactions').createIndex({ type: 1, recordedAt: -1 });
  await db.collection('stockTransactions').createIndex({ recordedAt: -1 });
}
