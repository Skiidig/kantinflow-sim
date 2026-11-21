import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { Decimal128, ObjectId } from 'mongodb';
import { ROLES } from './middleware/auth.mjs';
import { hashPassword } from './password.mjs';
import { createTestContext, TEST_MONGODB_URI } from './lib/http-context.mjs';

const loginError = { error: { code: 'INVALID_CREDENTIALS' } };

test('login issues a token that records a stock receipt (Supertest)', { skip: !TEST_MONGODB_URI }, async (t) => {
  const { db, secret, api } = await createTestContext(t);

  const password = randomBytes(18).toString('base64url');
  const passwordHash = await hashPassword(password);
  const itemId = new ObjectId();
  const petugasId = new ObjectId();
  const adminId = new ObjectId();
  const inactiveId = new ObjectId();
  const email = 'petugas@kantinflow.test';
  const adminEmail = 'admin@kantinflow.test';

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
    {
      _id: petugasId,
      name: 'Petugas Demo',
      email,
      role: ROLES.PETUGAS,
      isActive: true,
      passwordHash,
    },
    {
      _id: adminId,
      name: 'Admin Kantin',
      email: adminEmail,
      role: ROLES.ADMIN,
      isActive: true,
      passwordHash,
    },
    {
      _id: inactiveId,
      name: 'Petugas Nonaktif',
      email: 'nonaktif@kantinflow.test',
      role: ROLES.PETUGAS,
      isActive: false,
      passwordHash,
    },
  ]);

  const success = await api
    .post('/api/v1/auth/login')
    .send({ email: `  ${email.toUpperCase()} `, password });
  assert.equal(success.status, 200);
  assert.equal(success.headers['cache-control'], 'no-store');
  assert.equal(typeof success.body.data.token, 'string');
  assert.deepEqual(success.body.data.user, {
    id: petugasId.toHexString(), name: 'Petugas Demo', email, role: ROLES.PETUGAS,
  });
  assert.equal(JSON.stringify(success.body).includes(passwordHash), false);
  assert.equal('passwordHash' in success.body.data.user, false);

  const adminLogin = await api
    .post('/api/v1/auth/login')
    .send({ email: adminEmail, password });
  assert.equal(adminLogin.status, 200);
  assert.deepEqual(adminLogin.body.data.user, {
    id: adminId.toHexString(), name: 'Admin Kantin', email: adminEmail, role: ROLES.ADMIN,
  });

  const claims = jwt.verify(success.body.data.token, secret, { algorithms: ['HS256'] });
  assert.equal(claims.sub, petugasId.toHexString());
  assert.equal(claims.role, ROLES.PETUGAS);
  assert.ok(claims.exp > claims.iat);

  const wrongEmail = await api.post('/api/v1/auth/login').send({ email: 'tidak-ada@kantinflow.test', password });
  const wrongPassword = await api.post('/api/v1/auth/login').send({ email, password: `${password}x` });
  const inactive = await api.post('/api/v1/auth/login').send({ email: 'nonaktif@kantinflow.test', password });
  for (const attempt of [wrongEmail, wrongPassword, inactive]) {
    assert.equal(attempt.status, 401);
    assert.deepEqual(attempt.body, loginError);
  }

  const missing = await api.post('/api/v1/auth/login').send({ email: '', password: '' });
  assert.equal(missing.status, 400);
  assert.deepEqual(Object.keys(missing.body.error.fields).sort(), ['email', 'password']);

  const receipt = {
    itemId: itemId.toHexString(),
    batchCode: 'SUSU-LOGIN-1',
    quantity: '5',
    unitCost: '4500.00',
    receivedOn: '2026-11-17',
    expiresOn: '2026-11-24',
  };
  const first = await api
    .post('/api/v1/stock/receipts')
    .set('Authorization', `Bearer ${success.body.data.token}`)
    .set('Idempotency-Key', 'login-flow')
    .send(receipt);
  assert.equal(first.status, 201);
  assert.equal(first.body.data.stockBalance, '5');
  assert.equal(first.body.data.unit, 'kotak');

  const replay = await api
    .post('/api/v1/stock/receipts')
    .set('Authorization', `Bearer ${success.body.data.token}`)
    .set('Idempotency-Key', 'login-flow')
    .send(receipt);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);

  const zero = await api
    .post('/api/v1/stock/receipts')
    .set('Authorization', `Bearer ${success.body.data.token}`)
    .set('Idempotency-Key', 'login-zero')
    .send({ ...receipt, quantity: '0' });
  assert.equal(zero.status, 400);
  assert.deepEqual(zero.body, {
    error: { code: 'VALIDATION_ERROR', fields: { quantity: 'Jumlah harus lebih dari 0' } },
  });

  assert.equal(await db.collection('batches').countDocuments(), 1);
  assert.equal(await db.collection('stockTransactions').countDocuments(), 1);
});
