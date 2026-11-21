import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.mjs';

test('stores a salted bcrypt hash that verifies only the original password', async () => {
  const first = await hashPassword('RahasiaDemo123!');
  const second = await hashPassword('RahasiaDemo123!');
  assert.match(first, /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/u);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('RahasiaDemo123!', first), true);
  assert.equal(await verifyPassword('RahasiaDemo123', first), false);
});

test('rejects malformed stored hashes without throwing', async () => {
  for (const stored of [undefined, null, '', 'plaintext', 'scrypt$16384$8$1$00$00', '$2b$10$invalid']) {
    assert.equal(await verifyPassword('apa-saja', stored), false);
  }
});
