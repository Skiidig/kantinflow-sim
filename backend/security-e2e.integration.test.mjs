import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObjectId } from 'mongodb';
import { addDaysToDateString, toLocalDateString } from './lib/format.mjs';
import { ROLES } from './middleware/auth.mjs';
import { hashPassword } from './password.mjs';
import { createTestContext, TEST_MONGODB_URI } from './lib/http-context.mjs';

test('Security matrix: all protected endpoints reject unauthenticated (401) and enforce admin-only RBAC (403)', { skip: !TEST_MONGODB_URI }, async (t) => {
  const { db, api, signToken } = await createTestContext(t);

  const petugasId = new ObjectId();
  const dummyId = new ObjectId().toHexString();
  await db.collection('users').insertOne({
    _id: petugasId,
    name: 'Petugas Uji',
    email: 'petugas-sec@kantinflow.test',
    role: ROLES.PETUGAS,
    isActive: true,
    passwordHash: await hashPassword('Rahasia123!'),
  });

  const petugasToken = signToken(petugasId, ROLES.PETUGAS);

  const protectedEndpoints = [
    ['get', '/api/v1/users'],
    ['post', '/api/v1/users'],
    ['patch', `/api/v1/users/${dummyId}`],
    ['get', '/api/v1/items'],
    ['get', `/api/v1/items/${dummyId}`],
    ['get', `/api/v1/items/${dummyId}/batches`],
    ['post', '/api/v1/items'],
    ['patch', `/api/v1/items/${dummyId}`],
    ['delete', `/api/v1/items/${dummyId}`],
    ['get', '/api/v1/dashboard'],
    ['get', '/api/v1/transactions'],
    ['post', '/api/v1/stock/receipts'],
    ['post', '/api/v1/stock/usages'],
    ['post', '/api/v1/stock/disposals'],
    ['get', '/api/v1/reports/disposals'],
  ];

  // Tanpa token maupun token palsu -> wajib 401 UNAUTHENTICATED
  for (const [method, path] of protectedEndpoints) {
    const noAuth = await api[method](path).send({});
    assert.equal(noAuth.status, 401, `Expected 401 without token on ${method.toUpperCase()} ${path}`);
    assert.equal(noAuth.body.error.code, 'UNAUTHENTICATED');

    const badAuth = await api[method](path).set('Authorization', 'Bearer token-tidak-valid').send({});
    assert.equal(badAuth.status, 401, `Expected 401 with invalid token on ${method.toUpperCase()} ${path}`);
    assert.equal(badAuth.body.error.code, 'UNAUTHENTICATED');
  }

  // Endpoint khusus admin -> petugas wajib mendapat 403 FORBIDDEN
  const adminOnlyEndpoints = [
    ['get', '/api/v1/users'],
    ['post', '/api/v1/users'],
    ['patch', `/api/v1/users/${dummyId}`],
    ['post', '/api/v1/items'],
    ['patch', `/api/v1/items/${dummyId}`],
    ['delete', `/api/v1/items/${dummyId}`],
    ['get', '/api/v1/reports/disposals'],
  ];

  for (const [method, path] of adminOnlyEndpoints) {
    const res = await api[method](path).set('Authorization', `Bearer ${petugasToken}`).send({});
    assert.equal(res.status, 403, `Expected 403 for petugas on ${method.toUpperCase()} ${path}`);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
});

test('End-to-end SRS flow (FR-001 s.d. FR-007) exclusively via HTTP Supertest', { skip: !TEST_MONGODB_URI }, async (t) => {
  const { db, api } = await createTestContext(t);

  const adminPassword = 'AdminPassword123!';
  await db.collection('users').insertOne({
    _id: new ObjectId(),
    name: 'Admin Utama',
    email: 'admin-e2e@kantinflow.test',
    role: ROLES.ADMIN,
    isActive: true,
    passwordHash: await hashPassword(adminPassword),
    createdAt: new Date(),
  });

  // 1. FR-001: Login admin -> buat akun petugas -> login petugas
  const adminLogin = await api
    .post('/api/v1/auth/login')
    .send({ email: 'admin-e2e@kantinflow.test', password: adminPassword });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.body.data.token;

  const createStaff = await api
    .post('/api/v1/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Budi Petugas', email: 'budi@kantinflow.test', password: 'BudiPassword123!' });
  assert.equal(createStaff.status, 201);

  const staffLogin = await api
    .post('/api/v1/auth/login')
    .send({ email: 'budi@kantinflow.test', password: 'BudiPassword123!' });
  assert.equal(staffLogin.status, 200);
  const staffToken = staffLogin.body.data.token;

  // 2. FR-002 & FR-003: Admin buat barang Susu Kotak -> cari & temukan via GET /items
  const createItem = await api
    .post('/api/v1/items')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'SUSU-E2E', name: 'Susu Kotak Full Cream', baseUnit: 'kotak', minimumStock: '5' });
  assert.equal(createItem.status, 201);
  const itemId = createItem.body.data.id;

  const searchItem = await api
    .get('/api/v1/items?q=SUSU-E2E')
    .set('Authorization', `Bearer ${staffToken}`);
  assert.equal(searchItem.status, 200);
  assert.equal(searchItem.body.data[0].id, itemId);

  // 3. FR-005: Petugas terima batch A (5 kotak, H+2) dan batch B (7 kotak, H+10); jumlah 0 ditolak
  const today = toLocalDateString();
  const receiptA = await api
    .post('/api/v1/stock/receipts')
    .set('Authorization', `Bearer ${staffToken}`)
    .set('Idempotency-Key', 'e2e-batch-a')
    .send({
      itemId,
      batchCode: 'BATCH-A',
      quantity: '5',
      unitCost: '4500',
      receivedOn: today,
      expiresOn: addDaysToDateString(today, 2),
    });
  assert.equal(receiptA.status, 201);
  assert.equal(receiptA.body.data.stockBalance, '5');

  const receiptZero = await api
    .post('/api/v1/stock/receipts')
    .set('Authorization', `Bearer ${staffToken}`)
    .set('Idempotency-Key', 'e2e-batch-zero')
    .send({
      itemId,
      batchCode: 'BATCH-ZERO',
      quantity: '0',
      unitCost: '4500',
      receivedOn: today,
      expiresOn: addDaysToDateString(today, 2),
    });
  assert.equal(receiptZero.status, 400);

  const receiptB = await api
    .post('/api/v1/stock/receipts')
    .set('Authorization', `Bearer ${staffToken}`)
    .set('Idempotency-Key', 'e2e-batch-b')
    .send({
      itemId,
      batchCode: 'BATCH-B',
      quantity: '7',
      unitCost: '5000',
      receivedOn: today,
      expiresOn: addDaysToDateString(today, 10),
    });
  assert.equal(receiptB.status, 201);
  assert.equal(receiptB.body.data.stockBalance, '12');

  // 4. FR-004: Dashboard mendeteksi BATCH-A sebagai H-3
  const dashboard = await api.get('/api/v1/dashboard').set('Authorization', `Bearer ${staffToken}`);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.data.summary.expiringSoonCount, 1);
  assert.equal(dashboard.body.data.expiringSoonBatches[0].batchCode, 'BATCH-A');

  // 5. FR-006: Pemakaian FEFO 8 kotak -> 5 dari BATCH-A, 3 dari BATCH-B (sisa 4)
  const usage = await api
    .post('/api/v1/stock/usages')
    .set('Authorization', `Bearer ${staffToken}`)
    .set('Idempotency-Key', 'e2e-fefo-8')
    .send({ itemId, quantity: '8', note: 'Sajian pagi' });
  assert.equal(usage.status, 201);
  assert.deepEqual(
    usage.body.data.allocations.map((a) => [a.batchCode, a.quantityUsed, a.remainingQuantity]),
    [
      ['BATCH-A', '5', '0'],
      ['BATCH-B', '3', '4'],
    ],
  );

  // Meminta 5 kotak padahal sisa 4 -> ditolak 409, saldo tetap 4
  const overUsage = await api
    .post('/api/v1/stock/usages')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ itemId, quantity: '5' });
  assert.equal(overUsage.status, 409);

  // 6. FR-007: Petugas buang 1 kotak dari BATCH-B (harga 5000) -> admin melihat biaya 5000, petugas 403
  const disposal = await api
    .post('/api/v1/stock/disposals')
    .set('Authorization', `Bearer ${staffToken}`)
    .set('Idempotency-Key', 'e2e-dispose-1')
    .send({ batchId: receiptB.body.data.batchId, quantity: '1', reason: 'Kemasan penyok' });
  assert.equal(disposal.status, 201);
  assert.equal(disposal.body.data.physicalStock, '3');

  const staffReport = await api
    .get('/api/v1/reports/disposals')
    .set('Authorization', `Bearer ${staffToken}`);
  assert.equal(staffReport.status, 403);

  const adminReport = await api
    .get('/api/v1/reports/disposals')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(adminReport.status, 200);
  assert.equal(adminReport.body.data.summary.totalQuantity, '1');
  assert.equal(adminReport.body.data.summary.totalCost, '5000');

  // Riwayat transaksi: total 4 (2 RECEIPT, 1 USAGE, 1 DISPOSAL); biaya hanya untuk admin
  const staffTx = await api.get('/api/v1/transactions').set('Authorization', `Bearer ${staffToken}`);
  assert.equal(staffTx.status, 200);
  assert.equal(staffTx.body.meta.total, 4);
  assert.equal(staffTx.body.data.every((tx) => !('totalCost' in tx)), true);

  const adminTx = await api.get('/api/v1/transactions').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(adminTx.status, 200);
  assert.equal(adminTx.body.data.every((tx) => typeof tx.totalCost === 'string'), true);
});
