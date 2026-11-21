import { Decimal128, MongoClient } from 'mongodb';
import { ROLES } from '../middleware/auth.mjs';
import { hashPassword } from '../password.mjs';

const {
  MONGODB_URI,
  MONGODB_DB,
  DEMO_ADMIN_EMAIL = 'admin@kantinflow.local',
  DEMO_ADMIN_PASSWORD,
  DEMO_ADMIN_NAME = 'Admin Kantin',
  DEMO_PETUGAS_EMAIL,
  DEMO_PETUGAS_PASSWORD,
  DEMO_PETUGAS_NAME,
  DEMO_STAFF_EMAIL,
  DEMO_STAFF_PASSWORD,
  DEMO_STAFF_NAME = 'Petugas Demo',
} = process.env;

const petugasEmailRaw = DEMO_PETUGAS_EMAIL || DEMO_STAFF_EMAIL;
const petugasPassword = DEMO_PETUGAS_PASSWORD || DEMO_STAFF_PASSWORD;
const petugasName = DEMO_PETUGAS_NAME || DEMO_STAFF_NAME;
const adminPassword = DEMO_ADMIN_PASSWORD || petugasPassword;

if (!MONGODB_URI || !MONGODB_DB || !petugasEmailRaw || !petugasPassword) {
  throw new Error(
    'Isi MONGODB_URI, MONGODB_DB, DEMO_PETUGAS_EMAIL (atau DEMO_STAFF_EMAIL), dan DEMO_PETUGAS_PASSWORD (atau DEMO_STAFF_PASSWORD) di .env.',
  );
}

const resetStock = process.argv.includes('--reset');
const adminEmail = DEMO_ADMIN_EMAIL.trim().toLowerCase();
const petugasEmail = petugasEmailRaw.trim().toLowerCase();
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

  // Bersihkan indeks lama `sku_1` bila berasal dari tahap 1 sebelum migrasi ke `code`.
  try {
    await items.dropIndex('sku_1');
  } catch (err) {
    if (err.codeName !== 'IndexNotFound' && err.codeName !== 'NamespaceNotFound') throw err;
  }

  await items.createIndex(
    { code: 1 },
    { unique: true, partialFilterExpression: { code: { $type: 'string' } } },
  );

  const [adminPasswordHash, petugasPasswordHash] = await Promise.all([
    hashPassword(adminPassword),
    hashPassword(petugasPassword),
  ]);

  await users.updateOne(
    { email: adminEmail },
    {
      $set: {
        name: DEMO_ADMIN_NAME,
        email: adminEmail,
        role: ROLES.ADMIN,
        isActive: true,
        passwordHash: adminPasswordHash,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  await users.updateOne(
    { email: petugasEmail },
    {
      $set: {
        name: petugasName,
        email: petugasEmail,
        role: ROLES.PETUGAS,
        isActive: true,
        passwordHash: petugasPasswordHash,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  const item = await items.findOneAndUpdate(
    { $or: [{ code: 'SUSU-KOTAK' }, { sku: 'SUSU-KOTAK' }] },
    {
      $set: {
        code: 'SUSU-KOTAK',
        name: 'Susu Kotak',
        baseUnit: 'kotak',
        minimumStock: Decimal128.fromString('5'),
        quantityScale: 0,
        isActive: true,
        updatedAt: now,
      },
      $unset: { sku: '' },
      $setOnInsert: { stockRevision: 0, createdAt: now },
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
  console.log(`Akun admin    : ${adminEmail} (role: ${ROLES.ADMIN})`);
  console.log(
    `Password admin: ${DEMO_ADMIN_PASSWORD ? 'nilai DEMO_ADMIN_PASSWORD di .env' : 'mengikuti DEMO_PETUGAS_PASSWORD / DEMO_STAFF_PASSWORD'}`,
  );
  console.log(`Akun petugas  : ${petugasEmail} (role: ${ROLES.PETUGAS})`);
  console.log('Password ptgs : nilai DEMO_PETUGAS_PASSWORD / DEMO_STAFF_PASSWORD di .env');
  console.log(
    `Barang        : ${item.name} (code ${item.code}, minimumStock ${item.minimumStock.toString()} ${item.baseUnit})`,
  );
  console.log(`itemId        : ${item._id.toHexString()}`);
  console.log(`Saldo awal    : ${stockBalance} ${item.baseUnit}`);
  console.log('\nSalin itemId ke variabel koleksi Postman "itemId".');
  if (stockBalance !== '0' && !resetStock) {
    console.log('Saldo belum 0. Untuk demo dari nol, jalankan: npm.cmd run seed:reset');
  }
} finally {
  await client.close();
}
