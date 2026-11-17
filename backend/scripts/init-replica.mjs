import { MongoClient } from 'mongodb';

const port = process.argv[2] ?? '27017';
const replicaSet = process.argv[3] ?? 'rs0';
const uri = `mongodb://127.0.0.1:${port}/?directConnection=true`;

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
  const admin = client.db('admin').admin();

  try {
    const status = await admin.command({ replSetGetStatus: 1 });
    console.log(`Replica set "${status.set}" sudah aktif.`);
  } catch (err) {
    if (err.code !== 94 && err.codeName !== 'NotYetInitialized') throw err;
    await admin.command({
      replSetInitiate: {
        _id: replicaSet,
        members: [{ _id: 0, host: `127.0.0.1:${port}` }],
      },
    });
    console.log(`Replica set "${replicaSet}" diinisialisasi.`);
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const hello = await admin.command({ hello: 1 });
    if (hello.isWritablePrimary) {
      console.log(`MongoDB siap sebagai primary di 127.0.0.1:${port}.`);
      process.exitCode = 0;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (process.exitCode !== 0) {
    throw new Error('MongoDB belum menjadi primary setelah 15 detik.');
  }
} finally {
  await client.close();
}
