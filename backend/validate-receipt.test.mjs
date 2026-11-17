import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReceipt } from './validate-receipt.mjs';

const valid = {
  itemId: '000000000000000000000101',
  batchCode: 'SUSU-A',
  quantity: '5',
  unitCost: '4500.00',
  receivedOn: '2026-11-17',
  expiresOn: '2026-11-24',
};

test('accepts the planned receipt for five cartons', () => {
  assert.deepEqual(validateReceipt(valid), {});
});

test('rejects zero quantity with the agreed field error', () => {
  assert.deepEqual(validateReceipt({ ...valid, quantity: '0.00' }), {
    quantity: 'Jumlah harus lebih dari 0',
  });
});

test('rejects an impossible date and an expiry before receipt', () => {
  assert.ok(validateReceipt({ ...valid, receivedOn: '2026-02-30' }).receivedOn);
  assert.ok(validateReceipt({ ...valid, expiresOn: '2026-11-16' }).expiresOn);
});
