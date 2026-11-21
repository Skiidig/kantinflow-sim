import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDateId, formatRupiah, getBatchStatusMeta, getRoleLabel } from './format.js';

test('formatRupiah formats integer and decimal strings cleanly', () => {
  assert.equal(formatRupiah('4500'), 'Rp 4.500');
  assert.equal(formatRupiah('17000.50'), 'Rp 17.000,5');
  assert.equal(formatRupiah('0'), 'Rp 0');
  assert.equal(formatRupiah('1250000'), 'Rp 1.250.000');
});

test('formatDateId formats YYYY-MM-DD in Indonesian short format', () => {
  assert.equal(formatDateId('2026-11-21'), '21 Nov 2026');
  assert.equal(formatDateId('2026-01-05'), '5 Jan 2026');
  assert.equal(formatDateId(''), '—');
});

test('role and batch status helpers map labels accurately', () => {
  assert.equal(getRoleLabel('admin'), 'Admin');
  assert.equal(getRoleLabel('petugas'), 'Petugas');
  assert.deepEqual(getBatchStatusMeta('MENDEKATI_KEDALUWARSA'), {
    label: 'Mendekati H-3',
    tone: 'warning',
  });
});
