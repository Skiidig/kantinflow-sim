import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../api-error.mjs';
import { ROLES, authorize } from './auth.mjs';

test('authorize allows matching roles and rejects unauthorized or missing actor', () => {
  const adminOnly = authorize(ROLES.ADMIN);
  const operational = authorize(ROLES.ADMIN, ROLES.PETUGAS);

  let called = false;
  adminOnly({ actor: { role: ROLES.ADMIN } }, {}, () => { called = true; });
  assert.equal(called, true);

  called = false;
  operational({ actor: { role: ROLES.PETUGAS } }, {}, () => { called = true; });
  assert.equal(called, true);

  assert.throws(
    () => adminOnly({ actor: { role: ROLES.PETUGAS } }, {}, () => {}),
    (err) => err instanceof ApiError && err.status === 403 && err.code === 'FORBIDDEN',
  );

  assert.throws(
    () => operational({}, {}, () => {}),
    (err) => err instanceof ApiError && err.status === 401 && err.code === 'UNAUTHENTICATED',
  );
});
