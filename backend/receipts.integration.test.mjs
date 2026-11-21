import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Decimal128, ObjectId } from 'mongodb';
import { ROLES } from './middleware/auth.mjs';
import { createTestContext, TEST_MONGODB_URI } from './lib/http-context.mjs';

test('stock receipt HTTP endpoint, idempotency, and database transaction rollback (Supertest)', { skip: !TEST_MONGODB_URI }, async (t) => {
  const { db, api, signToken } = await createTestContext(t);

  const itemId = new ObjectId();
  const actorId = new ObjectId();
  const adminId = new ObjectId();
  const viewerId = new ObjectId();

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

  const petugas = signToken(actorId, ROLES.PETUGAS);
  const admin = signToken(adminId, ROLES.ADMIN);
  const viewer = signToken(viewerId, 'viewer');

  const body = {
    itemId: itemId.toHexString(),
    batchCode: 'SUSU-A',
    quantity: '5',
    unitCost: '4500.00',
    receivedOn: '2026-11-17',
    expiresOn: '2026-11-24',
  };

  function post(payload, key, token = petugas) {
    const req = api
      .post('/api/v1/stock/receipts')
      .set('Idempotency-Key', key);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(payload);
  }

  assert.equal((await post(body, 'first', '')).status, 401);
  assert.equal((await post(body, 'first', viewer)).status, 403);

  const attempts = await Promise.all([post(body, 'first'), post(body, 'first')]);
  assert.deepEqual(attempts.map(({ status }) => status).sort(), [200, 201]);
  assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.equal(attempts[0].body.data.stockBalance, '5');
  assert.equal(attempts[0].body.data.unit, 'kotak');

  assert.equal((await post({ ...body, quantity: '6' }, 'first')).status, 409);

  const zeroRes = await post({ ...body, quantity: '0' }, 'zero');
  assert.equal(zeroRes.status, 400);
  assert.deepEqual(zeroRes.body, {
    error: { code: 'VALIDATION_ERROR', fields: { quantity: 'Jumlah harus lebih dari 0' } },
  });
  assert.equal((await post({ ...body, quantity: '1.5' }, 'fraction')).status, 400);

  const batches = db.collection('batches');
  const transactions = db.collection('stockTransactions');
  const [batch] = await batches.find().toArray();
  const [receipt] = await transactions.find().toArray();
  assert.equal(batch.remainingQuantity.toString(), '5');
  assert.equal(receipt.lines[0].batchId.toHexString(), batch._id.toHexString());

  // Paksa insert riwayat gagal setelah insert batch kedua untuk memverifikasi rollback transaksi atomik.
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
