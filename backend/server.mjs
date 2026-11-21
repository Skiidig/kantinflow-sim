import { MongoClient } from 'mongodb';
import { createApp } from './app.mjs';
import { prepareDatabase } from './db-indexes.mjs';

const {
  MONGODB_URI,
  MONGODB_DB,
  JWT_SECRET,
  JWT_EXPIRES_IN = '8h',
  PORT = '3001',
  HOST = '0.0.0.0',
  CORS_ORIGIN = 'http://localhost:5173',
} = process.env;

if (!MONGODB_URI || !JWT_SECRET || Buffer.byteLength(JWT_SECRET) < 32) {
  throw new Error('Isi MONGODB_URI dan JWT_SECRET minimal 32 byte.');
}

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const db = MONGODB_DB ? client.db(MONGODB_DB) : client.db();
  await prepareDatabase(db);
  const server = createApp({
    client,
    db,
    jwtSecret: JWT_SECRET,
    tokenTtl: JWT_EXPIRES_IN,
    corsOrigin: CORS_ORIGIN,
  }).listen(
    Number(PORT),
    HOST,
    () => console.log(`KantinFlow SIM mendengarkan di ${HOST}:${PORT}`),
  );
  server.on('error', async (err) => {
    console.error(err.message);
    await client.close();
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(() => client.close()));
  }
} catch (err) {
  await client.close();
  throw err;
}
