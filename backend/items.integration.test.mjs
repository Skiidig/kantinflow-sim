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

test('FR-002 & FR-003 items CRUD, search/filter/sort/pagination, archive/delete rules, and batches', { skip: !uri }, async (t) => {
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

  await db.collection('users').insertMany([
    { _id: adminId, name: 'Admin', email: 'admin@test.local', role: ROLES.ADMIN, isActive: true },
    { _id: petugasId, name: 'Petugas', email: 'petugas@test.local', role: ROLES.PETUGAS, isActive: true },
  ]);

  const server = createApp({ client, db, jwtSecret: secret, tokenTtl: '5m' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const adminToken = jwt.sign({ role: ROLES.ADMIN }, secret, { subject: adminId.toHexString(), expiresIn: '5m' });
  const petugasToken = jwt.sign({ role: ROLES.PETUGAS }, secret, { subject: petugasId.toHexString(), expiresIn: '5m' });

  async function request(path, { method = 'GET', body, token, extraHeaders = {} } = {}) {
    const headers = { ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  // Tanpa token = 401; petugas dilarang POST/PATCH/DELETE = 403
  assert.equal((await request('/api/v1/items')).status, 401);
  assert.equal((await request('/api/v1/items', {
    method: 'POST',
    token: petugasToken,
    body: { code: 'AIR-01', name: 'Air Mineral', baseUnit: 'botol', minimumStock: '10' },
  })).status, 403);

  // Admin membuat 3 barang
  const susu = await request('/api/v1/items', {
    method: 'POST',
    token: adminToken,
    body: { code: 'susu-01', name: 'Susu Kotak Cokelat', baseUnit: 'kotak', minimumStock: '5' },
  });
  assert.equal(susu.status, 201);
  assert.equal(susu.body.data.code, 'SUSU-01');
  assert.equal(susu.body.data.minimumStock, '5');
  assert.equal(susu.body.data.physicalStock, '0');
  assert.equal(susu.body.data.usableStock, '0');
  assert.equal(susu.body.data.isLowStock, true);

  // Kode barang duplikat ditolak 409
  assert.equal((await request('/api/v1/items', {
    method: 'POST',
    token: adminToken,
    body: { code: 'SUSU-01', name: 'Duplikat', baseUnit: 'kotak', minimumStock: '1' },
  })).status, 409);

  const roti = await request('/api/v1/items', {
    method: 'POST',
    token: adminToken,
    body: { code: 'ROTI-01', name: 'Roti Tawar', baseUnit: 'bungkus', minimumStock: '3' },
  });
  assert.equal(roti.status, 201);

  const beras = await request('/api/v1/items', {
    method: 'POST',
    token: adminToken,
    body: { code: 'BRS-01', name: 'Beras Kantin', baseUnit: 'kg', minimumStock: '10.5', quantityScale: 2 },
  });
  assert.equal(beras.status, 201);
  assert.equal(beras.body.data.minimumStock, '10.5');

  // Tambah batch pada SUSU-01: 1 kedaluwarsa (sisa 2), 1 H-2 (sisa 3), 1 layak panjang (sisa 6)
  const today = toLocalDateString();
  const yesterday = addDaysToDateString(today, -1);
  const inTwoDays = addDaysToDateString(today, 2);
  const inTenDays = addDaysToDateString(today, 10);

  const susuObjectId = new ObjectId(susu.body.data.id);
  await db.collection('batches').insertMany([
    {
      itemId: susuObjectId,
      batchCode: 'SUSU-EXP',
      receivedOn: addDaysToDateString(today, -10),
      expiresOn: yesterday,
      unitCost: Decimal128.fromString('4000'),
      initialQuantity: Decimal128.fromString('2'),
      remainingQuantity: Decimal128.fromString('2'),
      recordedAt: new Date(),
    },
    {
      itemId: susuObjectId,
      batchCode: 'SUSU-H2',
      receivedOn: addDaysToDateString(today, -2),
      expiresOn: inTwoDays,
      unitCost: Decimal128.fromString('4500'),
      initialQuantity: Decimal128.fromString('3'),
      remainingQuantity: Decimal128.fromString('3'),
      recordedAt: new Date(),
    },
    {
      itemId: susuObjectId,
      batchCode: 'SUSU-FRESH',
      receivedOn: today,
      expiresOn: inTenDays,
      unitCost: Decimal128.fromString('4600'),
      initialQuantity: Decimal128.fromString('6'),
      remainingQuantity: Decimal128.fromString('6'),
      recordedAt: new Date(),
    },
  ]);

  // GET /api/v1/items (petugas dapat membaca): search nama/kode, filter lowStock, sort, pagination
  const searchByCode = await request('/api/v1/items?q=roti-01', { token: petugasToken });
  assert.equal(searchByCode.status, 200);
  assert.equal(searchByCode.body.data.length, 1);
  assert.equal(searchByCode.body.data[0].code, 'ROTI-01');

  const searchByName = await request('/api/v1/items?q=cokelat', { token: petugasToken });
  assert.equal(searchByName.status, 200);
  assert.equal(searchByName.body.data.length, 1);
  assert.equal(searchByName.body.data[0].physicalStock, '11');
  assert.equal(searchByName.body.data[0].usableStock, '9');
  assert.equal(searchByName.body.data[0].isLowStock, false);

  const lowStockList = await request('/api/v1/items?lowStock=true&sortBy=code&sortOrder=asc', { token: petugasToken });
  assert.equal(lowStockList.status, 200);
  assert.deepEqual(lowStockList.body.data.map((item) => item.code), ['BRS-01', 'ROTI-01']);

  const page2 = await request('/api/v1/items?sortBy=name&sortOrder=asc&page=2&limit=2', { token: adminToken });
  assert.equal(page2.status, 200);
  assert.equal(page2.body.meta.total, 3);
  assert.equal(page2.body.meta.totalPages, 2);
  assert.equal(page2.body.data.length, 1);
  assert.equal(page2.body.data[0].code, 'SUSU-01');

  // GET /api/v1/items/:id/batches: terurut expiresOn asc, unitCost hanya tampil untuk admin
  const adminBatches = await request(`/api/v1/items/${susu.body.data.id}/batches`, { token: adminToken });
  assert.equal(adminBatches.status, 200);
  assert.deepEqual(
    adminBatches.body.data.batches.map((b) => [b.batchCode, b.status]),
    [
      ['SUSU-EXP', 'KEDALUWARSA'],
      ['SUSU-H2', 'MENDEKATI_KEDALUWARSA'],
      ['SUSU-FRESH', 'LAYAK'],
    ],
  );
  assert.equal(adminBatches.body.data.batches[0].unitCost, '4000');

  const petugasBatches = await request(`/api/v1/items/${susu.body.data.id}/batches`, { token: petugasToken });
  assert.equal(petugasBatches.status, 200);
  assert.equal('unitCost' in petugasBatches.body.data.batches[0], false);

  // PATCH /api/v1/items/:id (petugas 403, admin 200)
  assert.equal((await request(`/api/v1/items/${roti.body.data.id}`, {
    method: 'PATCH',
    token: petugasToken,
    body: { name: 'Tidak Boleh' },
  })).status, 403);

  const patched = await request(`/api/v1/items/${roti.body.data.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { name: 'Roti Tawar Gandum', minimumStock: '4' },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.name, 'Roti Tawar Gandum');
  assert.equal(patched.body.data.minimumStock, '4');

  // Barang tanpa riwayat (ROTI-01) -> DELETE permanen = 204
  const deleted = await request(`/api/v1/items/${roti.body.data.id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  assert.equal(deleted.status, 204);
  assert.equal((await request(`/api/v1/items/${roti.body.data.id}`, { token: adminToken })).status, 404);

  // Barang berriwayat & masih ada stok fisik (SUSU-01, physicalStock 11):
  // baik PATCH isActive=false maupun DELETE wajib ditolak 409 ITEM_HAS_STOCK
  const archiveWithStockPatch = await request(`/api/v1/items/${susu.body.data.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { isActive: false },
  });
  assert.equal(archiveWithStockPatch.status, 409);
  assert.equal(archiveWithStockPatch.body.error.code, 'ITEM_HAS_STOCK');

  const deleteWithStock = await request(`/api/v1/items/${susu.body.data.id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  assert.equal(deleteWithStock.status, 409);
  assert.equal(deleteWithStock.body.error.code, 'ITEM_HAS_STOCK');

  // Nolkan semua sisa batch SUSU-01 (riwayat batch tetap ada, stok fisik = 0)
  await db.collection('batches').updateMany(
    { itemId: susuObjectId },
    { $set: { remainingQuantity: Decimal128.fromString('0') } },
  );

  // Sekarang DELETE mengarsipkan (200, isActive: false) tanpa menghapus dokumen/riwayat
  const archived = await request(`/api/v1/items/${susu.body.data.id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.data.isActive, false);
  assert.equal(archived.body.data.action, 'ARCHIVED');

  // Filter status=archived menampilkan SUSU-01, sedangkan status=active hanya menampilkan BRS-01
  const archivedList = await request('/api/v1/items?status=archived', { token: adminToken });
  assert.deepEqual(archivedList.body.data.map((item) => item.code), ['SUSU-01']);

  const activeList = await request('/api/v1/items?status=active', { token: adminToken });
  assert.deepEqual(activeList.body.data.map((item) => item.code), ['BRS-01']);

  // Batch status ketika remainingQuantity = 0 menjadi HABIS; ?onlyRemaining=true mengembalikan []
  const depletedBatches = await request(`/api/v1/items/${susu.body.data.id}/batches`, { token: adminToken });
  assert.equal(depletedBatches.body.data.batches.every((b) => b.status === 'HABIS'), true);

  const remainingOnly = await request(`/api/v1/items/${susu.body.data.id}/batches?onlyRemaining=true`, { token: adminToken });
  assert.equal(remainingOnly.body.data.batches.length, 0);
});
