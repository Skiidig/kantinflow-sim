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

test('FR-006 atomic FEFO usage and FR-007 batch disposal with admin-only cost report', { skip: !uri }, async (t) => {
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

  // Skenario SRS:
  // - SUSU-EXP: 3 kotak, sudah kedaluwarsa (harus dilewati FEFO)
  // - SUSU-A  : 5 kotak, kedaluwarsa +2 hari (terdekat -> dipotong pertama)
  // - SUSU-B  : 7 kotak, kedaluwarsa +10 hari (dipotong kedua)
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

  const server = createApp({ client, db, jwtSecret: secret, tokenTtl: '5m' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const adminToken = jwt.sign({ role: ROLES.ADMIN }, secret, { subject: adminId.toHexString(), expiresIn: '5m' });
  const petugasToken = jwt.sign({ role: ROLES.PETUGAS }, secret, { subject: petugasId.toHexString(), expiresIn: '5m' });

  async function request(path, { method = 'GET', body, token, key } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (key) headers['Idempotency-Key'] = key;
    const response = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  // --- FR-006: FEFO USAGE ---
  assert.equal((await request('/api/v1/stock/usages', { method: 'POST', body: {} })).status, 401);

  const zeroUsage = await request('/api/v1/stock/usages', {
    method: 'POST',
    token: petugasToken,
    body: { itemId: susuId.toHexString(), quantity: '0' },
  });
  assert.equal(zeroUsage.status, 400);
  assert.equal(zeroUsage.body.error.code, 'VALIDATION_ERROR');

  // Pemakaian 8 kotak -> 5 dari SUSU-A (sisa 0) + 3 dari SUSU-B (sisa 4); SUSU-EXP tetap 3
  const usagePayload = {
    itemId: susuId.toHexString(),
    quantity: '8',
    note: 'Kebutuhan produksi es susu',
  };
  const usageRes = await request('/api/v1/stock/usages', {
    method: 'POST',
    token: petugasToken,
    key: 'fefo-8-kotak',
    body: usagePayload,
  });
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

  // Replay dengan Idempotency-Key & payload sama -> 200 tanpa memotong ulang
  const usageReplay = await request('/api/v1/stock/usages', {
    method: 'POST',
    token: petugasToken,
    key: 'fefo-8-kotak',
    body: usagePayload,
  });
  assert.deepEqual(usageReplay, { status: 200, body: usageRes.body });

  // Key sama, payload beda -> 409 IDEMPOTENCY_CONFLICT
  const usageConflict = await request('/api/v1/stock/usages', {
    method: 'POST',
    token: petugasToken,
    key: 'fefo-8-kotak',
    body: { ...usagePayload, quantity: '2' },
  });
  assert.equal(usageConflict.status, 409);
  assert.equal(usageConflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

  // Stok layak tersisa 4 (meski stok fisik 7 karena 3 sudah kedaluwarsa):
  // Meminta 5 kotak wajib ditolak 409 INSUFFICIENT_USABLE_STOCK dan saldo tetap utuh!
  const insufficient = await request('/api/v1/stock/usages', {
    method: 'POST',
    token: petugasToken,
    body: { itemId: susuId.toHexString(), quantity: '5' },
  });
  assert.equal(insufficient.status, 409);
  assert.equal(insufficient.body.error.code, 'INSUFFICIENT_USABLE_STOCK');

  // Pastikan saldo seluruh batch dan jumlah transaksi tidak berubah sama sekali
  const batchesAfterFailedFefo = await db.collection('batches').find({ itemId: susuId }).toArray();
  const byCode = Object.fromEntries(batchesAfterFailedFefo.map((b) => [b.batchCode, b.remainingQuantity.toString()]));
  assert.deepEqual(byCode, { 'SUSU-EXP': '3', 'SUSU-A': '0', 'SUSU-B': '4' });
  assert.equal(await db.collection('stockTransactions').countDocuments(), 1);
  assert.equal((await db.collection('items').findOne({ _id: susuId })).stockRevision, 1);

  // --- FR-007: DISPOSAL & REPORT ---
  // Validasi alasan wajib & jumlah > 0
  const invalidDisposal = await request('/api/v1/stock/disposals', {
    method: 'POST',
    token: petugasToken,
    body: { batchId: expiredBatchId.toHexString(), quantity: '0', reason: '' },
  });
  assert.equal(invalidDisposal.status, 400);
  assert.deepEqual(Object.keys(invalidDisposal.body.error.fields).sort(), ['quantity', 'reason']);

  // Pembuangan melebihi sisa batch (sisa 3, buang 4) -> ditolak 409 tanpa ubah saldo
  const overDispose = await request('/api/v1/stock/disposals', {
    method: 'POST',
    token: petugasToken,
    body: { batchId: expiredBatchId.toHexString(), quantity: '4', reason: 'Kedaluwarsa' },
  });
  assert.equal(overDispose.status, 409);
  assert.equal(overDispose.body.error.code, 'INSUFFICIENT_BATCH_STOCK');

  // Buang 3 kotak SUSU-EXP (harga 4000 -> biaya 12000) oleh petugas
  const disposeExp = await request('/api/v1/stock/disposals', {
    method: 'POST',
    token: petugasToken,
    key: 'dispose-exp-3',
    body: { batchId: expiredBatchId.toHexString(), quantity: '3', reason: 'Kedaluwarsa' },
  });
  assert.equal(disposeExp.status, 201);
  assert.equal(disposeExp.body.data.batchRemainingQuantity, '0');
  assert.equal(disposeExp.body.data.physicalStock, '4');
  assert.equal(disposeExp.body.data.usableStock, '4');
  assert.equal('unitCost' in disposeExp.body.data, false);

  // Replay idempotensi disposal -> 200
  const disposeReplay = await request('/api/v1/stock/disposals', {
    method: 'POST',
    token: petugasToken,
    key: 'dispose-exp-3',
    body: { batchId: expiredBatchId.toHexString(), quantity: '3', reason: 'Kedaluwarsa' },
  });
  assert.deepEqual(disposeReplay, { status: 200, body: disposeExp.body });

  // Buang 1 kotak SUSU-B (harga 5000 -> biaya 5000) oleh admin
  const disposeDamaged = await request('/api/v1/stock/disposals', {
    method: 'POST',
    token: adminToken,
    body: { batchId: batchBId.toHexString(), quantity: '1', reason: 'Kemasan bocor' },
  });
  assert.equal(disposeDamaged.status, 201);
  assert.equal(disposeDamaged.body.data.batchRemainingQuantity, '3');
  assert.equal(disposeDamaged.body.data.physicalStock, '3');
  assert.equal(disposeDamaged.body.data.usableStock, '3');

  // Laporan biaya pembuangan: tanpa token = 401, petugas = 403, admin = 200
  assert.equal((await request('/api/v1/reports/disposals')).status, 401);
  assert.equal((await request('/api/v1/reports/disposals', { token: petugasToken })).status, 403);

  const report = await request(`/api/v1/reports/disposals?from=${today}&to=${today}`, { token: adminToken });
  assert.equal(report.status, 200);
  assert.equal(report.body.data.summary.totalEvents, 2);
  assert.equal(report.body.data.summary.totalQuantity, '4');
  assert.equal(report.body.data.summary.totalCost, '17000');
  assert.equal(report.body.data.byItem.length, 1);
  assert.equal(report.body.data.byItem[0].totalCost, '17000');
  assert.deepEqual(
    report.body.data.byReason.map((r) => [r.reason, r.totalQuantity, r.totalCost]),
    [
      ['Kedaluwarsa', '3', '12000'],
      ['Kemasan bocor', '1', '5000'],
    ],
  );

  // Filter tanggal di luar rentang -> ringkasan 0
  const pastDay = addDaysToDateString(today, -30);
  const emptyReport = await request(`/api/v1/reports/disposals?from=${pastDay}&to=${pastDay}`, { token: adminToken });
  assert.equal(emptyReport.status, 200);
  assert.equal(emptyReport.body.data.summary.totalEvents, 0);
  assert.equal(emptyReport.body.data.summary.totalCost, '0');
});
