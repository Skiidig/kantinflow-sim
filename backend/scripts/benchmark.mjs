import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import jwt from 'jsonwebtoken';
import { Decimal128, MongoClient, ObjectId } from 'mongodb';
import { createApp } from '../app.mjs';
import { prepareDatabase } from '../db-indexes.mjs';
import { addDaysToDateString, toLocalDateString } from '../lib/format.mjs';
import { ROLES } from '../middleware/auth.mjs';

const uri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI;
if (!uri) {
  throw new Error('Isi TEST_MONGODB_URI atau MONGODB_URI di backend/.env terlebih dahulu.');
}

const REQUESTS_PER_ENDPOINT = 100;
const CONCURRENCY = 10;
const ITEM_COUNT = 100;
const BATCHES_PER_ITEM = 3; // 300 batch total
const TARGET_MS = 500;

function summarize(name, samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const min = sorted[0];
  const avg = sum / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  const max = sorted[sorted.length - 1];
  return {
    endpoint: name,
    requests: sorted.length,
    min: Number(min.toFixed(2)),
    avg: Number(avg.toFixed(2)),
    p50: Number(p50.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    max: Number(max.toFixed(2)),
    pass: p95 < TARGET_MS && max < TARGET_MS,
  };
}

async function runLoad(baseUrl, path, token, totalRequests, concurrency) {
  // Warmup 5 request agar connection pool & query plan siap.
  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(baseUrl + path, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status !== 200) throw new Error(`Warmup failed (${res.status}) on ${path}`);
    await res.arrayBuffer();
  }

  const samples = [];
  let completed = 0;

  async function worker() {
    while (true) {
      const idx = completed;
      completed += 1;
      if (idx >= totalRequests) return;

      const t0 = performance.now();
      const res = await fetch(baseUrl + path, { headers: { Authorization: `Bearer ${token}` } });
      await res.arrayBuffer();
      const elapsed = performance.now() - t0;
      if (res.status !== 200) {
        throw new Error(`Request gagal (${res.status}) pada ${path}`);
      }
      samples.push(elapsed);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return samples;
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 6000 });
await client.connect();
const dbName = `kantinflow_bench_${randomBytes(8).toString('hex')}`;
const db = client.db(dbName);

let server;
try {
  await prepareDatabase(db);

  const adminId = new ObjectId();
  await db.collection('users').insertOne({
    _id: adminId,
    name: 'Admin Benchmark',
    email: 'bench@kantinflow.local',
    role: ROLES.ADMIN,
    isActive: true,
    createdAt: new Date(),
  });

  const today = toLocalDateString();
  const now = new Date();
  const items = [];
  const batches = [];
  const transactions = [];

  for (let i = 1; i <= ITEM_COUNT; i += 1) {
    const itemId = new ObjectId();
    const code = `BRG-${String(i).padStart(3, '0')}`;
    items.push({
      _id: itemId,
      code,
      name: `Barang Kantin ${String(i).padStart(3, '0')}`,
      baseUnit: i % 3 === 0 ? 'kg' : 'kotak',
      minimumStock: Decimal128.fromString(i % 5 === 0 ? '20' : '5'),
      quantityScale: i % 3 === 0 ? 2 : 0,
      isActive: true,
      stockRevision: BATCHES_PER_ITEM,
      createdAt: now,
      updatedAt: now,
    });

    // 3 batch per barang: 1 kedaluwarsa/habis, 1 H-3, 1 layak jangka panjang
    const batchSpecs = [
      {
        suffix: 'EXP',
        expiresOn: addDaysToDateString(today, -2),
        qty: i % 4 === 0 ? '2' : '0',
        cost: '4000',
      },
      {
        suffix: 'H2',
        expiresOn: addDaysToDateString(today, 2),
        qty: i % 5 === 0 ? '3' : '6',
        cost: '4500',
      },
      {
        suffix: 'SAFE',
        expiresOn: addDaysToDateString(today, 14),
        qty: i % 5 === 0 ? '5' : '12',
        cost: '4800',
      },
    ];

    for (const spec of batchSpecs) {
      const batchId = new ObjectId();
      batches.push({
        _id: batchId,
        itemId,
        batchCode: `${code}-${spec.suffix}`,
        receivedOn: addDaysToDateString(today, -5),
        expiresOn: spec.expiresOn,
        unitCost: Decimal128.fromString(spec.cost),
        initialQuantity: Decimal128.fromString('12'),
        remainingQuantity: Decimal128.fromString(spec.qty),
        recordedAt: now,
      });

      if (spec.suffix !== 'EXP') {
        transactions.push({
          _id: new ObjectId(),
          itemId,
          actorId: adminId,
          type: 'RECEIPT',
          recordedAt: now,
          lines: [
            {
              batchId,
              quantityDelta: Decimal128.fromString('12'),
              unitCostSnapshot: Decimal128.fromString(spec.cost),
            },
          ],
        });
      }
    }
  }

  await db.collection('items').insertMany(items);
  await db.collection('batches').insertMany(batches);
  await db.collection('stockTransactions').insertMany(transactions);

  const secret = randomBytes(32).toString('hex');
  const app = createApp({ client, db, jwtSecret: secret });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({ role: ROLES.ADMIN }, secret, {
    algorithm: 'HS256',
    subject: adminId.toHexString(),
    expiresIn: '10m',
  });

  const endpoints = [
    '/api/v1/items?page=1&limit=20&sortBy=name&sortOrder=asc',
    '/api/v1/items?q=BRG-05&lowStock=true',
    '/api/v1/dashboard',
  ];

  const results = [];
  for (const path of endpoints) {
    const samples = await runLoad(baseUrl, path, token, REQUESTS_PER_ENDPOINT, CONCURRENCY);
    results.push(summarize(path, samples));
  }

  console.log('=== KANTINFLOW API BENCHMARK ===');
  console.log(
    `Dataset   : ${items.length} items, ${batches.length} batches, ${transactions.length} transactions`,
  );
  console.log(`Beban uji : ${REQUESTS_PER_ENDPOINT} request/endpoint (konkurensi ${CONCURRENCY})`);
  console.log(`Target    : < ${TARGET_MS} ms (NFR Performa Bab 2.2 & Bab 4.2)\n`);
  console.table(results);

  const allPassed = results.every((r) => r.pass);
  console.log(
    allPassed
      ? '\nHASIL: LULUS — Seluruh endpoint memenuhi target waktu respons < 500 ms.'
      : '\nHASIL: GAGAL — Terdapat endpoint yang melebihi target 500 ms.',
  );
  if (!allPassed) process.exitCode = 1;
} finally {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    await db.dropDatabase();
  } finally {
    await client.close();
  }
}
