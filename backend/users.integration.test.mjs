import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObjectId } from 'mongodb';
import { ROLES } from './middleware/auth.mjs';
import { hashPassword } from './password.mjs';
import { createTestContext, TEST_MONGODB_URI } from './lib/http-context.mjs';

test('FR-001 users management endpoints enforce admin RBAC, bcrypt hashing, and email uniqueness (Supertest)', { skip: !TEST_MONGODB_URI }, async (t) => {
  const { db, api, signToken } = await createTestContext(t);

  const adminId = new ObjectId();
  const petugasId = new ObjectId();
  const initialHash = await hashPassword('AdminAwal123!');

  await db.collection('users').insertMany([
    {
      _id: adminId,
      name: 'Admin Utama',
      email: 'admin@kantinflow.test',
      role: ROLES.ADMIN,
      isActive: true,
      passwordHash: initialHash,
      createdAt: new Date(),
    },
    {
      _id: petugasId,
      name: 'Petugas Satu',
      email: 'petugas1@kantinflow.test',
      role: ROLES.PETUGAS,
      isActive: true,
      passwordHash: initialHash,
      createdAt: new Date(),
    },
  ]);

  const adminToken = signToken(adminId, ROLES.ADMIN);
  const petugasToken = signToken(petugasId, ROLES.PETUGAS);

  assert.equal((await api.get('/api/v1/users')).status, 401);
  assert.equal((await api.get('/api/v1/users').set('Authorization', `Bearer ${petugasToken}`)).status, 403);
  assert.equal(
    (await api
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${petugasToken}`)
      .send({ name: 'Baru', email: 'baru@kantinflow.test', password: 'Password123!' })).status,
    403,
  );

  const invalid = await api
    .post('/api/v1/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: '', email: 'bukan-email', password: '123', role: 'staff' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(Object.keys(invalid.body.error.fields).sort(), ['email', 'name', 'password', 'role']);

  const created = await api
    .post('/api/v1/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: '  Siti Rahayu  ',
      email: '  SITI@KantinFlow.Test ',
      password: 'PetugasBaru123!',
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.name, 'Siti Rahayu');
  assert.equal(created.body.data.email, 'siti@kantinflow.test');
  assert.equal(created.body.data.role, ROLES.PETUGAS);
  assert.equal(created.body.data.isActive, true);
  assert.equal('passwordHash' in created.body.data, false);

  const storedUser = await db.collection('users').findOne({ email: 'siti@kantinflow.test' });
  assert.match(storedUser.passwordHash, /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/u);

  const loginRes = await api
    .post('/api/v1/auth/login')
    .send({ email: 'siti@kantinflow.test', password: 'PetugasBaru123!' });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.data.user.role, ROLES.PETUGAS);

  const duplicate = await api
    .post('/api/v1/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: 'Siti Duplikat',
      email: 'SITI@kantinflow.test',
      password: 'PasswordLain123!',
    });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'EMAIL_EXISTS');

  const list = await api
    .get('/api/v1/users?role=petugas')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 2);
  for (const user of list.body.data) {
    assert.equal('passwordHash' in user, false);
    assert.equal(user.role, ROLES.PETUGAS);
  }

  assert.equal(
    (await api
      .patch(`/api/v1/users/${adminId.toHexString()}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })).status,
    409,
  );

  const deactivated = await api
    .patch(`/api/v1/users/${created.body.data.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ isActive: false });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.data.isActive, false);

  const blockedLogin = await api
    .post('/api/v1/auth/login')
    .send({ email: 'siti@kantinflow.test', password: 'PetugasBaru123!' });
  assert.equal(blockedLogin.status, 401);
});
