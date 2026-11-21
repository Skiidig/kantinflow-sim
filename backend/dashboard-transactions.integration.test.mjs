import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { Decimal128, MongoClient, ObjectId } from 'mongodb';
import { createApp } from './app.mjs';
import { prepareDatabase } from './db-indexes.mjs';
import { addDaysToDateString, toLocalDateString } from './lib/format.mjs';
import { ROLES } from './middleware/auth.mjs';

const uri = process.env.TEST_MONGODB_URI;

test('FR-004 dashboard monitoring and FR-005 transactions history with role-based cost filtering', { skip: !uri }, async (t) => {
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

  await prepareDatabase(db);
  const secret = randomBytes(32).toString('hex');
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
    // Roti: hanya punya batch kedaluwarsa (sisa 2) -> usableStock = 0 <= 3 (low stock) & masuk expiredBatches
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
    // Batch kedaluwarsa tapi sudah habis -> tidak boleh muncul di expiredBatches
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
    // Susu: batch H-3 (sisa 4) + batch H+4 (sisa 6) -> usableStock = 10 > 5 (bukan low stock)
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

  const server = createApp({ client, db, jwtSecret: secret, tokenTtl: '5m' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const adminToken = jwt.sign({ role: ROLES.ADMIN }, secret, { subject: adminId.toHexString(), expiresIn: '5m' });
  const petugasToken = jwt.sign({ role: ROLES.PETUGAS }, secret, { subject: petugasId.toHexString(), expiresIn: '5m' });

  async function get(path, token) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(baseUrl + path, { headers });
    return { status: response.status, body: await response.json() };
  }

  // Dashboard tanpa token = 401
  assert.equal((await get('/api/v1/dashboard')).status, 401);

  // Dashboard untuk admin
  const adminDash = await get('/api/v1/dashboard', adminToken);
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

  // Dashboard untuk petugas: unitCost tidak boleh muncul
  const petugasDash = await get('/api/v1/dashboard', petugasToken);
  assert.equal(petugasDash.status, 200);
  assert.equal('unitCost' in petugasDash.body.data.expiringSoonBatches[0], false);
  assert.equal('unitCost' in petugasDash.body.data.expiredBatches[0], false);

  // Transactions tanpa token = 401
  assert.equal((await get('/api/v1/transactions')).status, 401);

  // Transactions untuk admin: melihat semua biaya & urutan terbaru lebih dulu
  const adminTx = await get('/api/v1/transactions?page=1&limit=2', adminToken);
  assert.equal(adminTx.status, 200);
  assert.equal(adminTx.body.meta.total, 3);
  assert.equal(adminTx.body.meta.totalPages, 2);
  assert.deepEqual(adminTx.body.data.map((tx) => tx.type), ['DISPOSAL', 'USAGE']);
  assert.equal(adminTx.body.data[0].totalCost, '12000');
  assert.equal(adminTx.body.data[0].lines[0].unitCost, '12000');
  assert.equal(adminTx.body.data[1].totalCost, '9000');

  // Transactions untuk petugas: seluruh informasi biaya disembunyikan
  const petugasTx = await get('/api/v1/transactions', petugasToken);
  assert.equal(petugasTx.status, 200);
  assert.equal(petugasTx.body.data.length, 3);
  for (const tx of petugasTx.body.data) {
    assert.equal('totalCost' in tx, false);
    for (const line of tx.lines) {
      assert.equal('unitCost' in line, false);
      assert.equal('lineCost' in line, false);
    }
  }

  // Filter berdasarkan type, itemId, dan rentang tanggal (hari ini saja -> 2 transaksi)
  const todayTx = await get(`/api/v1/transactions?from=${today}&to=${today}`, adminToken);
  assert.equal(todayTx.status, 200);
  assert.equal(todayTx.body.data.length, 2);

  const onlyUsage = await get(`/api/v1/transactions?type=USAGE&itemId=${susuId.toHexString()}`, adminToken);
  assert.equal(onlyUsage.status, 200);
  assert.equal(onlyUsage.body.data.length, 1);
  assert.equal(onlyUsage.body.data[0].note, 'Pemakaian pagi');
});
