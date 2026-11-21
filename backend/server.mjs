import { MongoClient } from 'mongodb';
import { createApp } from './app.mjs';
import { prepareDatabase } from './db-indexes.mjs';

const {
  MONGODB_URI, MONGODB_DB, JWT_SECRET, JWT_EXPIRES_IN = '8h', PORT = '3000',
} = process.env;
if (!MONGODB_URI || !MONGODB_DB || !JWT_SECRET || Buffer.byteLength(JWT_SECRET) < 32) {
  throw new Error('Isi MONGODB_URI, MONGODB_DB, dan JWT_SECRET minimal 32 byte.');
}

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
  const db = client.db(MONGODB_DB);
  await prepareDatabase(db);
  const server = createApp({ client, db, jwtSecret: JWT_SECRET, tokenTtl: JWT_EXPIRES_IN }).listen(
    Number(PORT), '127.0.0.1', () => console.log('KantinFlow SIM mendengarkan di port ' + PORT),
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
