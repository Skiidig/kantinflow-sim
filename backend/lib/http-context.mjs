import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import { createApp } from '../app.mjs';
import { prepareDatabase } from '../db-indexes.mjs';

export const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI;

export async function createTestContext(t, { tokenTtl = '5m' } = {}) {
  const client = new MongoClient(TEST_MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
  await client.connect();
  const isolationId = randomBytes(12).toString('hex');
  const db = client.db(`kantinflow_test_${isolationId}`);

  t.after(async () => {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
    }
  });

  await prepareDatabase(db);
  const secret = randomBytes(32).toString('hex');
  const app = createApp({ client, db, jwtSecret: secret, tokenTtl });
  const api = request(app);

  function signToken(userId, role, expiresIn = tokenTtl) {
    return jwt.sign({ role }, secret, {
      algorithm: 'HS256',
      subject: userId.toHexString(),
      expiresIn,
    });
  }

  return { client, db, secret, app, api, signToken };
}
