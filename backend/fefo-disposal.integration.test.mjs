import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Decimal128, ObjectId } from 'mongodb';
import { addDaysToDateString, toLocalDateString } from './lib/format.mjs';
import { ROLES } from './middleware/auth.mjs';
import { createTestContext, TEST_MONGODB_URI } from './lib/http-context.mjs';

test('FR-006 atomic FEFO usage and FR-007 batch disposal with admin-only cost report (Supertest)', { skip: !TEST_MONGODB_URI }, async (t) => {
  const { db, api, signToken } = await createTestContext(t);

  const adminId = new ObjectId();
  const petugasId = new ObjectId();
  const susuId = new ObjectId();

  await db.collection('users').insertMany([
    { _id: adminId, name: 'Admin Kantin', email: 'admin@test.local', role: ROLES.ADMIN, isActive: true },
    { _id: petugasId, name: 'Petugas Kantin', email: 'petugas@test.local', role: ROLES.PETUGAS, isActive: true },
  ]);

  await db.collection('items').insertOne({
    _id: susuId,
    code: 'SUSU-KOTAK',
    name: 'Susu Kotak',
    baseUnit: 'kotak',
    minimumStock: Decimal128.fromString('5'),
    quantityScale: 0,
    isActive: true,
    stockRevision: 0,
  });

  const today = toLocalDateString();
  const expiredBatchId = new ObjectId();
  const batchAId = new ObjectId();
  const batchBId = new ObjectId();

  await db.collection('batches').insertMany([
    {
      _id: expiredBatchId,
      itemId: susuId,
      batchCode: 'SUSU-EXP',
      receivedOn: addDaysToDateString(today, -10),
      expiresOn: addDaysToDateString(today, -1),
      unitCost: Decimal128.fromString('4000'),
      initialQuantity: Decimal128.fromString('3'),
      remainingQuantity: Decimal128.fromString('3'),
      recordedAt: new Date(),
    },
    {
      _id: batchAId,
      itemId: susuId,
      batchCode: 'SUSU-A',
      receivedOn: addDaysToDateString(today, -3),
      expiresOn: addDaysToDateString(today, 2),
      unitCost: Decimal128.fromString('4500'),
      initialQuantity: Decimal128.fromString('5'),
      remainingQuantity: Decimal128.fromString('5'),
      recordedAt: new Date(),
    },
    {
      _id: batchBId,
      itemId: susuId,
      batchCode: 'SUSU-B',
      receivedOn: today,
      expiresOn: addDaysToDateString(today, 10),
      unitCost: Decimal128.fromString('5000'),
      initialQuantity: Decimal128.fromString('7'),
      remainingQuantity: Decimal128.fromString('7'),
      recordedAt: new Date(),
    },
  ]);

  const adminToken = signToken(adminId, ROLES.ADMIN);
  const petugasToken = signToken(petugasId, ROLES.PETUGAS);

  assert.equal((await api.post('/api/v1/stock/usages').send({})).status, 401);

  const zeroUsage = await api
    .post('/api/v1/stock/usages')
    .set('Authorization', `Bearer ${petugasToken}`)
    .send({ itemId: susuId.toHexString(), quantity: '0' });
  assert.equal(zeroUsage.status, 400);
  assert.equal(zeroUsage.body.error.code, 'VALIDATION_ERROR');

  const usagePayload = {
    itemId: susuId.toHexString(),
    quantity: '8',
    note: 'Kebutuhan produksi es susu',
  };
  const usageRes = await api
    .post('/api/v1/stock/usages')
    .set('Authorization', `Bearer ${petugasToken}`)
    .set('Idempotency-Key', 'fefo-8-kotak')
    .send(usagePayload);
  assert.equal(usageRes.status, 201);
  assert.equal(usageRes.body.data.quantity, '8');
  assert.equal(usageRes.body.data.usableStock, '4');
  assert.equal(usageRes.body.data.physicalStock, '7');
  assert.deepEqual(
    usageRes.body.data.allocations.map((a) => [a.batchCode, a.quantityUsed, a.remainingQuantity]),
    [
      ['SUSU-A', '5', '0'],
      ['SUSU-B', '3', '4'],
    ],
  );

  const usageReplay = await api
    .post('/api/v1/stock/usages')
    .set('Authorization', `Bearer ${petugasToken}`)
    .set('Idempotency-Key', 'fefo-8-kotak')
    .send(usagePayload);
  assert.equal(usageReplay.status, 200);
  assert.deepEqual(usageReplay.body, usageRes.body);

  const usageConflict = await api
    .post('/api/v1/stock/usages')
    .set('Authorization', `Bearer ${petugasToken}`)
    .set('Idempotency-Key', 'fefo-8-kotak')
    .send({ ...usagePayload, quantity: '2' });
  assert.equal(usageConflict.status, 409);
  assert.equal(usageConflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

  const insufficient = await api
    .post('/api/v1/stock/usages')
    .set('Authorization', `Bearer ${petugasToken}`)
    .send({ itemId: susuId.toHexString(), quantity: '5' });
  assert.equal(insufficient.status, 409);
  assert.equal(insufficient.body.error.code, 'INSUFFICIENT_USABLE_STOCK');

  const batchesAfterFailedFefo = await db.collection('batches').find({ itemId: susuId }).toArray();
  const byCode = Object.fromEntries(batchesAfterFailedFefo.map((b) => [b.batchCode, b.remainingQuantity.toString()]));
  assert.deepEqual(byCode, { 'SUSU-EXP': '3', 'SUSU-A': '0', 'SUSU-B': '4' });
  assert.equal(await db.collection('stockTransactions').countDocuments(), 1);
  assert.equal((await db.collection('items').findOne({ _id: susuId })).stockRevision, 1);

  const invalidDisposal = await api
    .post('/api/v1/stock/disposals')
    .set('Authorization', `Bearer ${petugasToken}`)
    .send({ batchId: expiredBatchId.toHexString(), quantity: '0', reason: '' });
  assert.equal(invalidDisposal.status, 400);
  assert.deepEqual(Object.keys(invalidDisposal.body.error.fields).sort(), ['quantity', 'reason']);

  const overDispose = await api
    .post('/api/v1/stock/disposals')
    .set('Authorization', `Bearer ${petugasToken}`)
    .send({ batchId: expiredBatchId.toHexString(), quantity: '4', reason: 'Kedaluwarsa' });
  assert.equal(overDispose.status, 409);
  assert.equal(overDispose.body.error.code, 'INSUFFICIENT_BATCH_STOCK');

  const disposeExp = await api
    .post('/api/v1/stock/disposals')
    .set('Authorization', `Bearer ${petugasToken}`)
    .set('Idempotency-Key', 'dispose-exp-3')
    .send({ batchId: expiredBatchId.toHexString(), quantity: '3', reason: 'Kedaluwarsa' });
  assert.equal(disposeExp.status, 201);
  assert.equal(disposeExp.body.data.batchRemainingQuantity, '0');
  assert.equal(disposeExp.body.data.physicalStock, '4');
  assert.equal(disposeExp.body.data.usableStock, '4');
  assert.equal('unitCost' in disposeExp.body.data, false);

  const disposeReplay = await api
    .post('/api/v1/stock/disposals')
    .set('Authorization', `Bearer ${petugasToken}`)
    .set('Idempotency-Key', 'dispose-exp-3')
    .send({ batchId: expiredBatchId.toHexString(), quantity: '3', reason: 'Kedaluwarsa' });
  assert.equal(disposeReplay.status, 200);
  assert.deepEqual(disposeReplay.body, disposeExp.body);

  const disposeDamaged = await api
    .post('/api/v1/stock/disposals')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ batchId: batchBId.toHexString(), quantity: '1', reason: 'Kemasan bocor' });
  assert.equal(disposeDamaged.status, 201);
  assert.equal(disposeDamaged.body.data.batchRemainingQuantity, '3');
  assert.equal(disposeDamaged.body.data.physicalStock, '3');
  assert.equal(disposeDamaged.body.data.usableStock, '3');

  assert.equal((await api.get('/api/v1/reports/disposals')).status, 401);
  assert.equal((await api.get('/api/v1/reports/disposals').set('Authorization', `Bearer ${petugasToken}`)).status, 403);

  const report = await api
    .get(`/api/v1/reports/disposals?from=${today}&to=${today}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(report.status, 200);
  assert.equal(report.body.data.summary.totalEvents, 2);
  assert.equal(report.body.data.summary.totalQuantity, '4');
  assert.equal(report.body.data.summary.totalCost, '17000');
  assert.equal(report.body.data.byItem[0].totalCost, '17000');
  assert.deepEqual(
    report.body.data.byReason.map((r) => [r.reason, r.totalQuantity, r.totalCost]),
    [
      ['Kedaluwarsa', '3', '12000'],
      ['Kemasan bocor', '1', '5000'],
    ],
  );

  const pastDay = addDaysToDateString(today, -30);
  const emptyReport = await api
    .get(`/api/v1/reports/disposals?from=${pastDay}&to=${pastDay}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(emptyReport.status, 200);
  assert.equal(emptyReport.body.data.summary.totalEvents, 0);
  assert.equal(emptyReport.body.data.summary.totalCost, '0');

  const archivedItemId = new ObjectId();
  const archivedBatchId = new ObjectId();
  await db.collection('items').insertOne({
    _id: archivedItemId,
    code: 'ARSIP-DISP',
    name: 'Barang Arsip Uji Disposal',
    baseUnit: 'kotak',
    minimumStock: Decimal128.fromString('2'),
    quantityScale: 0,
    isActive: false,
    stockRevision: 4,
  });
  await db.collection('batches').insertOne({
    _id: archivedBatchId,
    itemId: archivedItemId,
    batchCode: 'ARSIP-BATCH-01',
    receivedOn: addDaysToDateString(today, -5),
    expiresOn: addDaysToDateString(today, -1),
    unitCost: Decimal128.fromString('3000'),
    initialQuantity: Decimal128.fromString('2'),
    remainingQuantity: Decimal128.fromString('2'),
    recordedAt: new Date(),
  });

  const txCountBeforeArchivedDisposal = await db.collection('stockTransactions').countDocuments();
  const archivedDisposal = await api
    .post('/api/v1/stock/disposals')
    .set('Authorization', `Bearer ${petugasToken}`)
    .set('Idempotency-Key', 'dispose-archived-item')
    .send({ batchId: archivedBatchId.toHexString(), quantity: '1', reason: 'Kedaluwarsa' });
  assert.equal(archivedDisposal.status, 409);
  assert.equal(archivedDisposal.body.error.code, 'ITEM_INACTIVE');

  const archivedBatchAfter = await db.collection('batches').findOne({ _id: archivedBatchId });
  const archivedItemAfter = await db.collection('items').findOne({ _id: archivedItemId });
  assert.equal(archivedBatchAfter.remainingQuantity.toString(), '2');
  assert.equal(archivedItemAfter.stockRevision, 4);
  assert.equal(await db.collection('stockTransactions').countDocuments(), txCountBeforeArchivedDisposal);
});
