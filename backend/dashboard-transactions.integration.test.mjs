import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Decimal128, ObjectId } from 'mongodb';
import { addDaysToDateString, toLocalDateString } from './lib/format.mjs';
import { ROLES } from './middleware/auth.mjs';
import { createTestContext, TEST_MONGODB_URI } from './lib/http-context.mjs';

test('FR-004 dashboard monitoring and FR-005 transactions history with role-based cost filtering (Supertest)', { skip: !TEST_MONGODB_URI }, async (t) => {
  const { db, api, signToken } = await createTestContext(t);

  const adminId = new ObjectId();
  const petugasId = new ObjectId();
  const susuId = new ObjectId();
  const rotiId = new ObjectId();
  const archivedId = new ObjectId();

  await db.collection('users').insertMany([
    { _id: adminId, name: 'Admin Kantin', email: 'admin@test.local', role: ROLES.ADMIN, isActive: true },
    { _id: petugasId, name: 'Petugas Kantin', email: 'petugas@test.local', role: ROLES.PETUGAS, isActive: true },
  ]);

  await db.collection('items').insertMany([
    {
      _id: susuId,
      code: 'SUSU-01',
      name: 'Susu Kotak',
      baseUnit: 'kotak',
      minimumStock: Decimal128.fromString('5'),
      quantityScale: 0,
      isActive: true,
      stockRevision: 0,
    },
    {
      _id: rotiId,
      code: 'ROTI-01',
      name: 'Roti Tawar',
      baseUnit: 'bungkus',
      minimumStock: Decimal128.fromString('3'),
      quantityScale: 0,
      isActive: true,
      stockRevision: 0,
    },
    {
      _id: archivedId,
      code: 'ARSIP-01',
      name: 'Barang Arsip',
      baseUnit: 'pcs',
      minimumStock: Decimal128.fromString('10'),
      quantityScale: 0,
      isActive: false,
      stockRevision: 0,
    },
  ]);

  const today = toLocalDateString();
  const yesterday = addDaysToDateString(today, -1);
  const inThreeDays = addDaysToDateString(today, 3);
  const inFourDays = addDaysToDateString(today, 4);

  const expiredBatchId = new ObjectId();
  const h3BatchId = new ObjectId();
  const safeBatchId = new ObjectId();
  const emptyExpiredBatchId = new ObjectId();

  await db.collection('batches').insertMany([
    {
      _id: expiredBatchId,
      itemId: rotiId,
      batchCode: 'ROTI-EXP',
      receivedOn: addDaysToDateString(today, -5),
      expiresOn: yesterday,
      unitCost: Decimal128.fromString('12000'),
      initialQuantity: Decimal128.fromString('2'),
      remainingQuantity: Decimal128.fromString('2'),
      recordedAt: new Date(),
    },
    {
      _id: emptyExpiredBatchId,
      itemId: rotiId,
      batchCode: 'ROTI-EXP-HABIS',
      receivedOn: addDaysToDateString(today, -7),
      expiresOn: addDaysToDateString(today, -2),
      unitCost: Decimal128.fromString('12000'),
      initialQuantity: Decimal128.fromString('4'),
      remainingQuantity: Decimal128.fromString('0'),
      recordedAt: new Date(),
    },
    {
      _id: h3BatchId,
      itemId: susuId,
      batchCode: 'SUSU-H3',
      receivedOn: today,
      expiresOn: inThreeDays,
      unitCost: Decimal128.fromString('4500'),
      initialQuantity: Decimal128.fromString('4'),
      remainingQuantity: Decimal128.fromString('4'),
      recordedAt: new Date(),
    },
    {
      _id: safeBatchId,
      itemId: susuId,
      batchCode: 'SUSU-AMAN',
      receivedOn: today,
      expiresOn: inFourDays,
      unitCost: Decimal128.fromString('4600'),
      initialQuantity: Decimal128.fromString('6'),
      remainingQuantity: Decimal128.fromString('6'),
      recordedAt: new Date(),
    },
  ]);

  const now = new Date();
  const earlier = new Date(now.getTime() - 60_000);
  const oldDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

  await db.collection('stockTransactions').insertMany([
    {
      _id: new ObjectId(),
      itemId: susuId,
      actorId: petugasId,
      type: 'RECEIPT',
      recordedAt: oldDate,
      lines: [
        {
          batchId: h3BatchId,
          quantityDelta: Decimal128.fromString('4'),
          unitCostSnapshot: Decimal128.fromString('4500'),
        },
      ],
    },
    {
      _id: new ObjectId(),
      itemId: susuId,
      actorId: petugasId,
      type: 'USAGE',
      recordedAt: earlier,
      note: 'Pemakaian pagi',
      lines: [
        {
          batchId: h3BatchId,
          quantityDelta: Decimal128.fromString('-2'),
          unitCostSnapshot: Decimal128.fromString('4500'),
        },
      ],
    },
    {
      _id: new ObjectId(),
      itemId: rotiId,
      actorId: adminId,
      type: 'DISPOSAL',
      reason: 'Berjamur',
      recordedAt: now,
      lines: [
        {
          batchId: expiredBatchId,
          quantityDelta: Decimal128.fromString('-1'),
          unitCostSnapshot: Decimal128.fromString('12000'),
        },
      ],
    },
  ]);

  const adminToken = signToken(adminId, ROLES.ADMIN);
  const petugasToken = signToken(petugasId, ROLES.PETUGAS);

  assert.equal((await api.get('/api/v1/dashboard')).status, 401);

  const adminDash = await api.get('/api/v1/dashboard').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(adminDash.status, 200);
  assert.equal(adminDash.body.data.summary.totalActiveItems, 2);
  assert.equal(adminDash.body.data.summary.lowStockCount, 1);
  assert.equal(adminDash.body.data.summary.expiringSoonCount, 1);
  assert.equal(adminDash.body.data.summary.expiredRemainingCount, 1);
  assert.deepEqual(adminDash.body.data.lowStockItems.map((i) => i.code), ['ROTI-01']);
  assert.deepEqual(adminDash.body.data.expiringSoonBatches.map((b) => b.batchCode), ['SUSU-H3']);
  assert.equal(adminDash.body.data.expiringSoonBatches[0].daysUntilExpiry, 3);
  assert.equal(adminDash.body.data.expiringSoonBatches[0].unitCost, '4500');
  assert.deepEqual(adminDash.body.data.expiredBatches.map((b) => b.batchCode), ['ROTI-EXP']);
  assert.equal(adminDash.body.data.expiredBatches[0].daysOverdue, 1);
  assert.equal(adminDash.body.data.expiredBatches[0].unitCost, '12000');

  const petugasDash = await api.get('/api/v1/dashboard').set('Authorization', `Bearer ${petugasToken}`);
  assert.equal(petugasDash.status, 200);
  assert.equal('unitCost' in petugasDash.body.data.expiringSoonBatches[0], false);
  assert.equal('unitCost' in petugasDash.body.data.expiredBatches[0], false);

  assert.equal((await api.get('/api/v1/transactions')).status, 401);

  const adminTx = await api
    .get('/api/v1/transactions?page=1&limit=2')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(adminTx.status, 200);
  assert.equal(adminTx.body.meta.total, 3);
  assert.equal(adminTx.body.meta.totalPages, 2);
  assert.deepEqual(adminTx.body.data.map((tx) => tx.type), ['DISPOSAL', 'USAGE']);
  assert.equal(adminTx.body.data[0].totalCost, '12000');
  assert.equal(adminTx.body.data[0].lines[0].unitCost, '12000');
  assert.equal(adminTx.body.data[1].totalCost, '9000');

  const petugasTx = await api.get('/api/v1/transactions').set('Authorization', `Bearer ${petugasToken}`);
  assert.equal(petugasTx.status, 200);
  assert.equal(petugasTx.body.data.length, 3);
  for (const tx of petugasTx.body.data) {
    assert.equal('totalCost' in tx, false);
    for (const line of tx.lines) {
      assert.equal('unitCost' in line, false);
      assert.equal('lineCost' in line, false);
    }
  }

  const todayTx = await api
    .get(`/api/v1/transactions?from=${today}&to=${today}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(todayTx.status, 200);
  assert.equal(todayTx.body.data.length, 2);

  const onlyUsage = await api
    .get(`/api/v1/transactions?type=USAGE&itemId=${susuId.toHexString()}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(onlyUsage.status, 200);
  assert.equal(onlyUsage.body.data.length, 1);
  assert.equal(onlyUsage.body.data[0].note, 'Pemakaian pagi');
});
