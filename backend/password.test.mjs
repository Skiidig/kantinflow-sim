import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.mjs';

test('stores a salted hash that verifies only the original password', async () => {
  const first = await hashPassword('RahasiaDemo123!');
  const second = await hashPassword('RahasiaDemo123!');
  assert.match(first, /^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/u);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('RahasiaDemo123!', first), true);
  assert.equal(await verifyPassword('RahasiaDemo123', first), false);
});

test('rejects malformed stored hashes without throwing', async () => {
  for (const stored of [undefined, null, '', 'plaintext', 'scrypt$1$2$3$zz$zz']) {
    assert.equal(await verifyPassword('apa-saja', stored), false);
  }
});
