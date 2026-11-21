import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from './app.mjs';

test('GET /api/v1/health returns 200 ok publicly and CORS allows configured origins & headers', async () => {
  const app = createApp({
    client: null,
    db: { collection: () => ({}) },
    jwtSecret: '0123456789abcdef0123456789abcdef',
    corsOrigin: 'https://kantinflow-sim.vercel.app/, http://localhost:5173',
  });
  const api = request(app);

  // Health check publik untuk Render
  const health = await api.get('/api/v1/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: 'ok' });

  // Preflight OPTIONS dari origin yang diizinkan (Vercel)
  const preflight = await api
    .options('/api/v1/stock/receipts')
    .set('Origin', 'https://kantinflow-sim.vercel.app')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'Authorization, Content-Type, Idempotency-Key');

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://kantinflow-sim.vercel.app');
  const allowedHeaders = preflight.headers['access-control-allow-headers'];
  assert.ok(allowedHeaders.includes('Authorization'));
  assert.ok(allowedHeaders.includes('Content-Type'));
  assert.ok(allowedHeaders.includes('Idempotency-Key'));

  // Origin kedua (lokal) juga diizinkan
  const localHealth = await api
    .get('/api/v1/health')
    .set('Origin', 'http://localhost:5173');
  assert.equal(localHealth.headers['access-control-allow-origin'], 'http://localhost:5173');

  // Origin asing tidak mendapat header Access-Control-Allow-Origin
  const blocked = await api
    .get('/api/v1/health')
    .set('Origin', 'https://evil.example.com');
  assert.equal(blocked.status, 200);
  assert.equal(blocked.headers['access-control-allow-origin'], undefined);
});
