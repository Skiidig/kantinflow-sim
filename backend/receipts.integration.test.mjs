import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { Decimal128, MongoClient, ObjectId } from 'mongodb';
import { createApp } from './app.mjs';
import { ROLES } from './middleware/auth.mjs';
import { prepareReceiptStore } from './receipt-store.mjs';

const uri = process.env.TEST_MONGODB_URI;

test('stock receipt HTTP endpoint and database transaction', { skip: !uri }, async (t) => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 6000 });
  await client.connect();
  const isolationId = randomBytes(12).toString('hex');
  const db = client.db('kantinflow_test_' + isolationId);
  t.after(async () => {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
    }
  });
  const itemId = new ObjectId();
  const actorId = new ObjectId();
  const adminId = new ObjectId();
  const viewerId = new ObjectId();
  const secret = randomBytes(32).toString('hex');
  await prepareReceiptStore(db);
  await db.collection('items').insertOne({
    _id: itemId,
    code: 'SUSU-KOTAK',
    name: 'Susu Kotak',
    baseUnit: 'kotak',
    minimumStock: Decimal128.fromString('5'),
    quantityScale: 0,
    isActive: true,
  });
  await db.collection('users').insertMany([
    { _id: actorId, isActive: true, role: ROLES.PETUGAS },
    { _id: adminId, isActive: true, role: ROLES.ADMIN },
    { _id: viewerId, isActive: true, role: 'viewer' },
  ]);

  const server = createApp({ client, db, jwtSecret: secret }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/stock/receipts`;
  const petugas = jwt.sign({}, secret, { subject: actorId.toHexString(), expiresIn: '5m' });
  const admin = jwt.sign({}, secret, { subject: adminId.toHexString(), expiresIn: '5m' });
  const viewer = jwt.sign({}, secret, { subject: viewerId.toHexString(), expiresIn: '5m' });
  const body = {
    itemId: itemId.toHexString(), batchCode: 'SUSU-A', quantity: '5',
    unitCost: '4500.00', receivedOn: '2026-11-17', expiresOn: '2026-11-24',
  };
  async function post(payload, key, token = petugas) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  }

  assert.equal((await post(body, 'first', '')).status, 401);
  assert.equal((await post(body, 'first', viewer)).status, 403);
  const attempts = await Promise.all([post(body, 'first'), post(body, 'first')]);
  assert.deepEqual(attempts.map(({ status }) => status).sort(), [200, 201]);
  assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.equal(attempts[0].body.data.stockBalance, '5');
  assert.equal(attempts[0].body.data.unit, 'kotak');
  assert.equal((await post({ ...body, quantity: '6' }, 'first')).status, 409);
  assert.deepEqual(await post({ ...body, quantity: '0' }, 'zero'), {
    status: 400, body: { error: { code: 'VALIDATION_ERROR', fields: { quantity: 'Jumlah harus lebih dari 0' } } },
  });
  assert.equal((await post({ ...body, quantity: '1.5' }, 'fraction')).status, 400);

  const batches = db.collection('batches');
  const transactions = db.collection('stockTransactions');
  const [batch] = await batches.find().toArray();
  const [receipt] = await transactions.find().toArray();
  assert.equal(batch.remainingQuantity.toString(), '5');
  assert.equal(receipt.lines[0].batchId.toHexString(), batch._id.toHexString());

  // Force the history insert to fail after the second batch insert.
  await transactions.createIndex({ type: 1 }, { unique: true });
  assert.equal((await post({ ...body, batchCode: 'SUSU-B' }, 'rollback')).status, 500);
  assert.equal(await batches.countDocuments(), 1);
  assert.equal(await transactions.countDocuments(), 1);
  assert.equal((await db.collection('items').findOne({ _id: itemId })).stockRevision, 1);

  // Hapus indeks pemicu gagal, lalu pastikan role admin juga berwenang mencatat penerimaan.
  await transactions.dropIndex('type_1');
  const adminReceipt = await post({ ...body, batchCode: 'SUSU-ADMIN', quantity: '2' }, 'admin-ok', admin);
  assert.equal(adminReceipt.status, 201);
  assert.equal(adminReceipt.body.data.stockBalance, '7');
});
