import { MongoClient } from 'mongodb';
import { createApp } from '../app.mjs';
import { prepareDatabase } from '../db-indexes.mjs';

let appPromise = null;

async function initApp() {
  const {
    MONGODB_URI,
    MONGODB_DB,
    JWT_SECRET,
    JWT_EXPIRES_IN = '8h',
    CORS_ORIGIN = 'http://localhost:5173',
  } = process.env;

  if (!MONGODB_URI || !JWT_SECRET || Buffer.byteLength(JWT_SECRET) < 32) {
    throw new Error('Isi MONGODB_URI dan JWT_SECRET minimal 32 byte pada Environment Variables Vercel.');
  }

  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
  });

  try {
    await client.connect();
    const db = MONGODB_DB ? client.db(MONGODB_DB) : client.db();
    await prepareDatabase(db);
    return createApp({
      client,
      db,
      jwtSecret: JWT_SECRET,
      tokenTtl: JWT_EXPIRES_IN,
      corsOrigin: CORS_ORIGIN,
    });
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
}

function getApp() {
  if (!appPromise) {
    appPromise = initApp().catch((err) => {
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}
