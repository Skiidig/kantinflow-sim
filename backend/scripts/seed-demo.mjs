import { MongoClient } from 'mongodb';
import { hashPassword } from '../password.mjs';

const {
  MONGODB_URI, MONGODB_DB, DEMO_STAFF_EMAIL, DEMO_STAFF_PASSWORD, DEMO_STAFF_NAME = 'Petugas Demo',
} = process.env;

if (!MONGODB_URI || !MONGODB_DB || !DEMO_STAFF_EMAIL || !DEMO_STAFF_PASSWORD) {
  throw new Error(
    'Isi MONGODB_URI, MONGODB_DB, DEMO_STAFF_EMAIL, dan DEMO_STAFF_PASSWORD di .env.',
  );
}

const resetStock = process.argv.includes('--reset');
const email = DEMO_STAFF_EMAIL.trim().toLowerCase();
const now = new Date();
const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });

try {
  await client.connect();
  const db = client.db(MONGODB_DB);
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName) {
    throw new Error(
      'MongoDB ini bukan replica set. Transaksi membutuhkan replica set; jalankan npm run db:start.',
    );
  }

  const users = db.collection('users');
  const items = db.collection('items');
  await users.createIndex(
    { email: 1 },
    { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
  );
  await items.createIndex(
    { sku: 1 },
    { unique: true, partialFilterExpression: { sku: { $type: 'string' } } },
  );

  const passwordHash = await hashPassword(DEMO_STAFF_PASSWORD);
  await users.updateOne(
    { email },
    {
      $set: {
        name: DEMO_STAFF_NAME, email, role: 'staff', isActive: true, passwordHash, updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  const item = await items.findOneAndUpdate(
    { sku: 'SUSU-KOTAK' },
    {
      $set: {
        name: 'Susu Kotak', baseUnit: 'kotak', quantityScale: 0, isActive: true, updatedAt: now,
      },
      $setOnInsert: { sku: 'SUSU-KOTAK', stockRevision: 0, createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );

  if (resetStock) {
    await db.collection('stockTransactions').deleteMany({ itemId: item._id });
    await db.collection('batches').deleteMany({ itemId: item._id });
    await items.updateOne({ _id: item._id }, { $set: { stockRevision: 0 } });
  }

  const [balance] = await db.collection('batches').aggregate([
    { $match: { itemId: item._id } },
    { $group: { _id: null, total: { $sum: '$remainingQuantity' } } },
  ]).toArray();
  const stockBalance = balance ? balance.total.toString() : '0';

  console.log(`Database      : ${MONGODB_DB} (replica set ${hello.setName})`);
  console.log(`Akun petugas  : ${email}`);
  console.log('Password      : nilai DEMO_STAFF_PASSWORD di .env');
  console.log('Barang        : Susu Kotak (sku SUSU-KOTAK)');
  console.log(`itemId        : ${item._id.toHexString()}`);
  console.log(`Saldo awal    : ${stockBalance} ${item.baseUnit}`);
  console.log('\nSalin itemId ke variabel koleksi Postman "itemId".');
  if (stockBalance !== '0' && !resetStock) {
    console.log('Saldo belum 0. Untuk demo dari nol, jalankan: npm.cmd run seed:reset');
  }
} finally {
  await client.close();
}
