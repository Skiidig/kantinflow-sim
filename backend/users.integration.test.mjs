import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';
import { createApp } from './app.mjs';
import { prepareDatabase } from './db-indexes.mjs';
import { ROLES } from './middleware/auth.mjs';
import { hashPassword } from './password.mjs';

const uri = process.env.TEST_MONGODB_URI;

test('FR-001 users management endpoints enforce admin RBAC, bcrypt hashing, and email uniqueness', { skip: !uri }, async (t) => {
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

  const server = createApp({ client, db, jwtSecret: secret, tokenTtl: '5m' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const adminToken = jwt.sign({ role: ROLES.ADMIN }, secret, { subject: adminId.toHexString(), expiresIn: '5m' });
  const petugasToken = jwt.sign({ role: ROLES.PETUGAS }, secret, { subject: petugasId.toHexString(), expiresIn: '5m' });

  async function request(path, { method = 'GET', body, token } = {}) {
    const headers = {};
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

  // Tanpa sesi = 401; petugas = 403
  assert.equal((await request('/api/v1/users')).status, 401);
  assert.equal((await request('/api/v1/users', { token: petugasToken })).status, 403);
  assert.equal((await request('/api/v1/users', {
    method: 'POST',
    token: petugasToken,
    body: { name: 'Baru', email: 'baru@kantinflow.test', password: 'Password123!' },
  })).status, 403);

  // Validasi input tidak valid = 400
  const invalid = await request('/api/v1/users', {
    method: 'POST',
    token: adminToken,
    body: { name: '', email: 'bukan-email', password: '123', role: 'staff' },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(Object.keys(invalid.body.error.fields).sort(), ['email', 'name', 'password', 'role']);

  // Admin membuat akun petugas dengan email berhuruf besar & spasi -> dinormalisasi + bcrypt hash
  const created = await request('/api/v1/users', {
    method: 'POST',
    token: adminToken,
    body: {
      name: '  Siti Rahayu  ',
      email: '  SITI@KantinFlow.Test ',
      password: 'PetugasBaru123!',
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.name, 'Siti Rahayu');
  assert.equal(created.body.data.email, 'siti@kantinflow.test');
  assert.equal(created.body.data.role, ROLES.PETUGAS);
  assert.equal(created.body.data.isActive, true);
  assert.equal('passwordHash' in created.body.data, false);

  // Verifikasi di MongoDB tersimpan sebagai hash bcrypt, bukan plaintext
  const storedUser = await db.collection('users').findOne({ email: 'siti@kantinflow.test' });
  assert.match(storedUser.passwordHash, /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/u);

  // Akun baru langsung bisa login
  const loginRes = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'siti@kantinflow.test', password: 'PetugasBaru123!' },
  });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.data.user.role, ROLES.PETUGAS);

  // Email duplikat ditolak 409
  const duplicate = await request('/api/v1/users', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Siti Duplikat',
      email: 'SITI@kantinflow.test',
      password: 'PasswordLain123!',
    },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'EMAIL_EXISTS');

  // GET /api/v1/users mengembalikan daftar tanpa passwordHash
  const list = await request('/api/v1/users?role=petugas', { token: adminToken });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 2);
  for (const user of list.body.data) {
    assert.equal('passwordHash' in user, false);
    assert.equal(user.role, ROLES.PETUGAS);
  }

  // Admin tidak bisa menonaktifkan dirinya sendiri, tapi bisa menonaktifkan petugas
  assert.equal((await request(`/api/v1/users/${adminId.toHexString()}`, {
    method: 'PATCH',
    token: adminToken,
    body: { isActive: false },
  })).status, 409);

  const deactivated = await request(`/api/v1/users/${created.body.data.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { isActive: false },
  });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.data.isActive, false);

  const blockedLogin = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'siti@kantinflow.test', password: 'PetugasBaru123!' },
  });
  assert.equal(blockedLogin.status, 401);
});
