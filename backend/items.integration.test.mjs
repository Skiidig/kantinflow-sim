import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Decimal128, ObjectId } from 'mongodb';
import { addDaysToDateString, toLocalDateString } from './lib/format.mjs';
import { ROLES } from './middleware/auth.mjs';
import { createTestContext, TEST_MONGODB_URI } from './lib/http-context.mjs';

test('FR-002 & FR-003 items CRUD, search/filter/sort/pagination, archive/delete rules, and batches (Supertest)', { skip: !TEST_MONGODB_URI }, async (t) => {
  const { db, api, signToken } = await createTestContext(t);

  const adminId = new ObjectId();
  const petugasId = new ObjectId();

  await db.collection('users').insertMany([
    { _id: adminId, name: 'Admin', email: 'admin@test.local', role: ROLES.ADMIN, isActive: true },
    { _id: petugasId, name: 'Petugas', email: 'petugas@test.local', role: ROLES.PETUGAS, isActive: true },
  ]);

  const adminToken = signToken(adminId, ROLES.ADMIN);
  const petugasToken = signToken(petugasId, ROLES.PETUGAS);

  assert.equal((await api.get('/api/v1/items')).status, 401);
  assert.equal(
    (await api
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${petugasToken}`)
      .send({ code: 'AIR-01', name: 'Air Mineral', baseUnit: 'botol', minimumStock: '10' })).status,
    403,
  );

  const susu = await api
    .post('/api/v1/items')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'susu-01', name: 'Susu Kotak Cokelat', baseUnit: 'kotak', minimumStock: '5' });
  assert.equal(susu.status, 201);
  assert.equal(susu.body.data.code, 'SUSU-01');
  assert.equal(susu.body.data.minimumStock, '5');
  assert.equal(susu.body.data.physicalStock, '0');
  assert.equal(susu.body.data.usableStock, '0');
  assert.equal(susu.body.data.isLowStock, true);

  assert.equal(
    (await api
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'SUSU-01', name: 'Duplikat', baseUnit: 'kotak', minimumStock: '1' })).status,
    409,
  );

  const roti = await api
    .post('/api/v1/items')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'ROTI-01', name: 'Roti Tawar', baseUnit: 'bungkus', minimumStock: '3' });
  assert.equal(roti.status, 201);

  const beras = await api
    .post('/api/v1/items')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'BRS-01', name: 'Beras Kantin', baseUnit: 'kg', minimumStock: '10.5', quantityScale: 2 });
  assert.equal(beras.status, 201);
  assert.equal(beras.body.data.minimumStock, '10.5');

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

  const searchByCode = await api.get('/api/v1/items?q=roti-01').set('Authorization', `Bearer ${petugasToken}`);
  assert.equal(searchByCode.status, 200);
  assert.equal(searchByCode.body.data.length, 1);
  assert.equal(searchByCode.body.data[0].code, 'ROTI-01');

  const searchByName = await api.get('/api/v1/items?q=cokelat').set('Authorization', `Bearer ${petugasToken}`);
  assert.equal(searchByName.status, 200);
  assert.equal(searchByName.body.data[0].physicalStock, '11');
  assert.equal(searchByName.body.data[0].usableStock, '9');
  assert.equal(searchByName.body.data[0].isLowStock, false);

  const lowStockList = await api
    .get('/api/v1/items?lowStock=true&sortBy=code&sortOrder=asc')
    .set('Authorization', `Bearer ${petugasToken}`);
  assert.equal(lowStockList.status, 200);
  assert.deepEqual(lowStockList.body.data.map((item) => item.code), ['BRS-01', 'ROTI-01']);

  const page2 = await api
    .get('/api/v1/items?sortBy=name&sortOrder=asc&page=2&limit=2')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(page2.status, 200);
  assert.equal(page2.body.meta.total, 3);
  assert.equal(page2.body.meta.totalPages, 2);
  assert.equal(page2.body.data[0].code, 'SUSU-01');

  const adminBatches = await api
    .get(`/api/v1/items/${susu.body.data.id}/batches`)
    .set('Authorization', `Bearer ${adminToken}`);
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

  const petugasBatches = await api
    .get(`/api/v1/items/${susu.body.data.id}/batches`)
    .set('Authorization', `Bearer ${petugasToken}`);
  assert.equal(petugasBatches.status, 200);
  assert.equal('unitCost' in petugasBatches.body.data.batches[0], false);

  assert.equal(
    (await api
      .patch(`/api/v1/items/${roti.body.data.id}`)
      .set('Authorization', `Bearer ${petugasToken}`)
      .send({ name: 'Tidak Boleh' })).status,
    403,
  );

  const patched = await api
    .patch(`/api/v1/items/${roti.body.data.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Roti Tawar Gandum', minimumStock: '4' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.name, 'Roti Tawar Gandum');
  assert.equal(patched.body.data.minimumStock, '4');

  // Barang tanpa riwayat -> hapus permanen 204
  const deleted = await api
    .delete(`/api/v1/items/${roti.body.data.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(deleted.status, 204);
  assert.equal(
    (await api.get(`/api/v1/items/${roti.body.data.id}`).set('Authorization', `Bearer ${adminToken}`)).status,
    404,
  );

  // Barang berriwayat & stok fisik > 0 -> ditolak 409 ITEM_HAS_STOCK
  const archiveWithStockPatch = await api
    .patch(`/api/v1/items/${susu.body.data.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ isActive: false });
  assert.equal(archiveWithStockPatch.status, 409);
  assert.equal(archiveWithStockPatch.body.error.code, 'ITEM_HAS_STOCK');

  const deleteWithStock = await api
    .delete(`/api/v1/items/${susu.body.data.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(deleteWithStock.status, 409);
  assert.equal(deleteWithStock.body.error.code, 'ITEM_HAS_STOCK');

  // Nolkan sisa batch -> sekarang diarsipkan (isActive: false, 200)
  await db.collection('batches').updateMany(
    { itemId: susuObjectId },
    { $set: { remainingQuantity: Decimal128.fromString('0') } },
  );

  const archived = await api
    .delete(`/api/v1/items/${susu.body.data.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(archived.status, 200);
  assert.equal(archived.body.data.isActive, false);
  assert.equal(archived.body.data.action, 'ARCHIVED');

  const archivedList = await api.get('/api/v1/items?status=archived').set('Authorization', `Bearer ${adminToken}`);
  assert.deepEqual(archivedList.body.data.map((item) => item.code), ['SUSU-01']);

  const activeList = await api.get('/api/v1/items?status=active').set('Authorization', `Bearer ${adminToken}`);
  assert.deepEqual(activeList.body.data.map((item) => item.code), ['BRS-01']);

  const depletedBatches = await api
    .get(`/api/v1/items/${susu.body.data.id}/batches`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(depletedBatches.body.data.batches.every((b) => b.status === 'HABIS'), true);

  const remainingOnly = await api
    .get(`/api/v1/items/${susu.body.data.id}/batches?onlyRemaining=true`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(remainingOnly.body.data.batches.length, 0);
});
