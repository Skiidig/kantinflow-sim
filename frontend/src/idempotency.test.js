import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdempotencyKey } from './idempotency.js';

test('reuses the same key when retrying an identical payload', () => {
  const first = resolveIdempotencyKey(null, 'payload-5-kotak', () => 'key-pertama');
  assert.equal(first.key, 'key-pertama');
  assert.equal(first.reused, false);

  const retry = resolveIdempotencyKey(first, 'payload-5-kotak', () => {
    throw new Error('key baru tidak boleh dibuat');
  });
  assert.equal(retry.key, 'key-pertama');
  assert.equal(retry.reused, true);
});

test('creates a new key after the form content changes', () => {
  const first = resolveIdempotencyKey(null, 'payload-5-kotak', () => 'key-pertama');
  const zero = resolveIdempotencyKey(first, 'payload-0-kotak', () => 'key-kedua');
  assert.equal(zero.key, 'key-kedua');
  assert.equal(zero.reused, false);
  assert.notEqual(zero.key, first.key);
});
