import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Decimal128, ObjectId } from 'mongodb';
import { addDaysToDateString, toOperationalDateString } from './lib/format.mjs';
import { createTestContext, TEST_MONGODB_URI } from './lib/http-context.mjs';
import { ROLES } from './middleware/auth.mjs';
import { getDashboardData } from './services/dashboard.service.mjs';
import { listItemBatches } from './services/items.service.mjs';
import { recordUsage } from './services/usage.service.mjs';

test('WITA operational date handles H-0 inclusion, H-3 classification, expired exclusion, and FEFO order', { skip: !TEST_MONGODB_URI }, async (t) => {
  const { client, db } = await createTestContext(t);

  const actorId = new ObjectId();
  const itemId = new ObjectId();
  await db.collection('users').insertOne({
    _id: actorId,
    name: 'Petugas WITA',
    email: 'petugas-wita@test.local',
    role: ROLES.PETUGAS,
    isActive: true,
  });
  await db.collection('items').insertOne({
    _id: itemId,
    code: 'SUSU-WITA',
    name: 'Susu Kotak WITA',
    baseUnit: 'kotak',
    minimumStock: Decimal128.fromString('5'),
    quantityScale: 0,
    isActive: true,
    stockRevision: 0,
  });

  // UTC is 2026-11-22 18:30:00Z, which is already 2026-11-23 02:30:00 WITA.
  const witaToday = toOperationalDateString(new Date('2026-11-22T18:30:00.000Z'));
  assert.equal(witaToday, '2026-11-23');

  const expiredId = new ObjectId();
  const h0Id = new ObjectId();
  const h3Id = new ObjectId();
  const safeId = new ObjectId();

  await db.collection('batches').insertMany([
    {
      _id: expiredId,
      itemId,
      batchCode: 'WITA-EXP',
      receivedOn: addDaysToDateString(witaToday, -10),
      expiresOn: addDaysToDateString(witaToday, -1), // 2026-11-22 (expired in WITA)
      unitCost: Decimal128.fromString('4000'),
      initialQuantity: Decimal128.fromString('3'),
      remainingQuantity: Decimal128.fromString('3'),
      recordedAt: new Date('2026-11-22T16:00:00.000Z'),
    },
    {
      _id: h0Id,
      itemId,
      batchCode: 'WITA-H0',
      receivedOn: addDaysToDateString(witaToday, -3),
      expiresOn: witaToday, // 2026-11-23 (H-0: still usable)
      unitCost: Decimal128.fromString('4500'),
      initialQuantity: Decimal128.fromString('4'),
      remainingQuantity: Decimal128.fromString('4'),
      recordedAt: new Date('2026-11-22T16:00:00.000Z'),
    },
    {
      _id: h3Id,
      itemId,
      batchCode: 'WITA-H3',
      receivedOn: addDaysToDateString(witaToday, -2),
      expiresOn: addDaysToDateString(witaToday, 3), // 2026-11-26 (H-3 boundary)
      unitCost: Decimal128.fromString('4600'),
      initialQuantity: Decimal128.fromString('5'),
      remainingQuantity: Decimal128.fromString('5'),
      recordedAt: new Date('2026-11-22T16:00:00.000Z'),
    },
    {
      _id: safeId,
      itemId,
      batchCode: 'WITA-H4',
      receivedOn: witaToday,
      expiresOn: addDaysToDateString(witaToday, 4), // 2026-11-27 (outside H-3)
      unitCost: Decimal128.fromString('4700'),
      initialQuantity: Decimal128.fromString('6'),
      remainingQuantity: Decimal128.fromString('6'),
      recordedAt: new Date('2026-11-22T16:00:00.000Z'),
    },
  ]);

  // 1. Batch status classification & usableStock (excludes expired, includes H-0)
  const batchList = await listItemBatches(db, itemId.toHexString(), {
    role: ROLES.ADMIN,
    today: witaToday,
  });
  assert.equal(batchList.item.physicalStock, '18');
  assert.equal(batchList.item.usableStock, '15');
  assert.deepEqual(
    batchList.batches.map((b) => [b.batchCode, b.status]),
    [
      ['WITA-EXP', 'KEDALUWARSA'],
      ['WITA-H0', 'MENDEKATI_KEDALUWARSA'],
      ['WITA-H3', 'MENDEKATI_KEDALUWARSA'],
      ['WITA-H4', 'LAYAK'],
    ],
  );

  // 2. Dashboard H-3 classification & H-0 inclusion
  const dash = await getDashboardData(db, { role: ROLES.ADMIN, days: 3, today: witaToday });
  assert.equal(dash.summary.asOfDate, '2026-11-23');
  assert.deepEqual(
    dash.expiringSoonBatches.map((b) => [b.batchCode, b.daysUntilExpiry]),
    [
      ['WITA-H0', 0],
      ['WITA-H3', 3],
    ],
  );
  assert.deepEqual(
    dash.expiredBatches.map((b) => [b.batchCode, b.daysOverdue]),
    [['WITA-EXP', 1]],
  );

  // 3. FEFO allocation consumes H-0 first, spills into H-3, and skips expired batch
  const usage = await recordUsage({
    client,
    db,
    actorId,
    key: 'wita-fefo-h0',
    body: { itemId: itemId.toHexString(), quantity: '6' },
    today: witaToday,
  });
  assert.equal(usage.status, 201);
  assert.deepEqual(
    usage.data.allocations.map((a) => [a.batchCode, a.quantityUsed, a.remainingQuantity]),
    [
      ['WITA-H0', '4', '0'],
      ['WITA-H3', '2', '3'],
    ],
  );
  assert.equal(usage.data.usableStock, '9');
  assert.equal(usage.data.physicalStock, '12');

  const expiredAfter = await db.collection('batches').findOne({ _id: expiredId });
  assert.equal(expiredAfter.remainingQuantity.toString(), '3');
});

test('date-range filters for transactions and disposal reports follow WITA midnight boundaries', { skip: !TEST_MONGODB_URI }, async (t) => {
  const { db, api, signToken } = await createTestContext(t);

  const adminId = new ObjectId();
  const itemId = new ObjectId();
  const batchId = new ObjectId();

  await db.collection('users').insertOne({
    _id: adminId,
    name: 'Admin WITA',
    email: 'admin-wita@test.local',
    role: ROLES.ADMIN,
    isActive: true,
  });
  await db.collection('items').insertOne({
    _id: itemId,
    code: 'ROTI-WITA',
    name: 'Roti WITA',
    baseUnit: 'bungkus',
    minimumStock: Decimal128.fromString('2'),
    quantityScale: 0,
    isActive: true,
    stockRevision: 0,
  });
  await db.collection('batches').insertOne({
    _id: batchId,
    itemId,
    batchCode: 'ROTI-B1',
    receivedOn: '2026-11-20',
    expiresOn: '2026-11-25',
    unitCost: Decimal128.fromString('5000'),
    initialQuantity: Decimal128.fromString('10'),
    remainingQuantity: Decimal128.fromString('6'),
    recordedAt: new Date('2026-11-20T00:00:00.000Z'),
  });

  // Insert 4 DISPOSAL transactions straddling WITA midnight boundaries for 2026-11-23:
  // - 2026-11-22T15:59:59.999Z -> 2026-11-22 23:59:59.999 WITA (excluded)
  // - 2026-11-22T16:00:00.000Z -> 2026-11-23 00:00:00.000 WITA (included)
  // - 2026-11-23T15:59:59.999Z -> 2026-11-23 23:59:59.999 WITA (included)
  // - 2026-11-23T16:00:00.000Z -> 2026-11-24 00:00:00.000 WITA (excluded)
  const makeDisposalTx = (reason, isoUtc) => ({
    _id: new ObjectId(),
    itemId,
    actorId: adminId,
    type: 'DISPOSAL',
    reason,
    recordedAt: new Date(isoUtc),
    lines: [
      {
        batchId,
        quantityDelta: Decimal128.fromString('-1'),
        unitCostSnapshot: Decimal128.fromString('5000'),
      },
    ],
  });

  await db.collection('stockTransactions').insertMany([
    makeDisposalTx('BEFORE_WITA_DAY', '2026-11-22T15:59:59.999Z'),
    makeDisposalTx('START_WITA_DAY', '2026-11-22T16:00:00.000Z'),
    makeDisposalTx('END_WITA_DAY', '2026-11-23T15:59:59.999Z'),
    makeDisposalTx('AFTER_WITA_DAY', '2026-11-23T16:00:00.000Z'),
  ]);

  const adminToken = signToken(adminId, ROLES.ADMIN);

  const txRes = await api
    .get('/api/v1/transactions?from=2026-11-23&to=2026-11-23')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(txRes.status, 200);
  assert.equal(txRes.body.meta.total, 2);
  assert.deepEqual(
    txRes.body.data.map((tx) => tx.reason),
    ['END_WITA_DAY', 'START_WITA_DAY'],
  );

  const reportRes = await api
    .get('/api/v1/reports/disposals?from=2026-11-23&to=2026-11-23')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(reportRes.status, 200);
  assert.equal(reportRes.body.data.summary.totalEvents, 2);
  assert.equal(reportRes.body.data.summary.totalQuantity, '2');
  assert.equal(reportRes.body.data.summary.totalCost, '10000');
  assert.deepEqual(
    reportRes.body.data.disposals.map((d) => d.reason),
    ['END_WITA_DAY', 'START_WITA_DAY'],
  );
});
