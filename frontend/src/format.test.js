import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  OPERATIONAL_TIMEZONE,
  addDaysToCalendarDate,
  formatDateId,
  formatDateTimeId,
  formatRupiah,
  getBatchStatusMeta,
  getOperationalDateString,
  getRoleLabel,
  validateDateRange,
} from './format.js';

test('formatRupiah formats integer and decimal strings cleanly', () => {
  assert.equal(formatRupiah('4500'), 'Rp 4.500');
  assert.equal(formatRupiah('17000.50'), 'Rp 17.000,5');
  assert.equal(formatRupiah('0'), 'Rp 0');
  assert.equal(formatRupiah('1250000'), 'Rp 1.250.000');
});

test('formatDateId preserves YYYY-MM-DD calendar dates in Indonesian short format', () => {
  assert.equal(formatDateId('2026-11-21'), '21 Nov 2026');
  assert.equal(formatDateId('2026-01-05'), '5 Jan 2026');
  assert.equal(formatDateId(''), '—');
});

test('formatDateTimeId and operational date defaults follow Asia/Makassar across UTC/WITA midnight', () => {
  assert.equal(OPERATIONAL_TIMEZONE, 'Asia/Makassar');

  // 2026-11-22T15:59:59.999Z is 2026-11-22 23:59 WITA
  assert.equal(getOperationalDateString(new Date('2026-11-22T15:59:59.999Z')), '2026-11-22');
  assert.equal(formatDateTimeId('2026-11-22T15:59:59.999Z'), '22 Nov 2026, 23:59');

  // 2026-11-22T16:00:00.000Z is 2026-11-23 00:00 WITA (next day in WITA while still 22 Nov in UTC)
  const atWitaMidnight = new Date('2026-11-22T16:00:00.000Z');
  const defaultReceivedOn = getOperationalDateString(atWitaMidnight);
  assert.equal(defaultReceivedOn, '2026-11-23');
  assert.equal(addDaysToCalendarDate(defaultReceivedOn, 7), '2026-11-30');
  assert.equal(formatDateTimeId('2026-11-22T16:00:00.000Z'), '23 Nov 2026, 00:00');
  assert.equal(formatDateTimeId('2026-11-22T18:35:00.000Z'), '23 Nov 2026, 02:35');
  assert.equal(formatDateTimeId(''), '—');
});

test('frontend operational date and timestamp display are identical under different host TZ settings', () => {
  const script = `
    import { addDaysToCalendarDate, formatDateId, formatDateTimeId, getOperationalDateString } from './frontend/src/format.js';
    const sample = new Date('2026-11-22T18:35:00.000Z');
    const receivedOn = getOperationalDateString(sample);
    console.log(JSON.stringify({
      receivedOn,
      expiresOn: addDaysToCalendarDate(receivedOn, 7),
      calendarDisplay: formatDateId('2026-11-23'),
      timestampDisplay: formatDateTimeId(sample.toISOString()),
    }));
  `;

  const expected = {
    receivedOn: '2026-11-23',
    expiresOn: '2026-11-30',
    calendarDisplay: '23 Nov 2026',
    timestampDisplay: '23 Nov 2026, 02:35',
  };

  for (const tz of ['UTC', 'America/New_York', 'Asia/Jakarta', 'Asia/Makassar']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('../..', import.meta.url),
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    }).trim();
    assert.deepEqual(JSON.parse(out), expected, `Mismatch when TZ=${tz}`);
  }
});

test('validateDateRange allows valid or single-ended ranges and rejects from > to', () => {
  assert.equal(validateDateRange('', ''), '');
  assert.equal(validateDateRange('2026-11-23', ''), '');
  assert.equal(validateDateRange('', '2026-11-23'), '');
  assert.equal(validateDateRange('2026-11-23', '2026-11-23'), '');
  assert.equal(validateDateRange('2026-11-20', '2026-11-23'), '');
  assert.equal(
    validateDateRange('2026-12-01', '2026-11-23'),
    'Tanggal akhir tidak boleh mendahului tanggal awal.',
  );
});

test('role and batch status helpers map labels accurately', () => {
  assert.equal(getRoleLabel('admin'), 'Admin');
  assert.equal(getRoleLabel('petugas'), 'Petugas');
  assert.deepEqual(getBatchStatusMeta('MENDEKATI_KEDALUWARSA'), {
    label: 'Mendekati H-3',
    tone: 'warning',
  });
});
