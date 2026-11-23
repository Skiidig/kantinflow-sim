import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import {
  OPERATIONAL_TIMEZONE,
  addDaysToDateString,
  endOfOperationalDay,
  startOfOperationalDay,
  toLocalDateString,
  toOperationalDateString,
} from './format.mjs';

test('operational date conversion uses Asia/Makassar (WITA, UTC+08:00) across midnight boundaries', () => {
  assert.equal(OPERATIONAL_TIMEZONE, 'Asia/Makassar');

  // 1 ms before WITA midnight (2026-11-22 23:59:59.999 WITA)
  const beforeMidnightWita = new Date('2026-11-22T15:59:59.999Z');
  assert.equal(toOperationalDateString(beforeMidnightWita), '2026-11-22');
  assert.equal(toLocalDateString(beforeMidnightWita), '2026-11-22');

  // Exact WITA midnight (2026-11-23 00:00:00.000 WITA, while UTC is still 2026-11-22)
  const atMidnightWita = new Date('2026-11-22T16:00:00.000Z');
  assert.equal(toOperationalDateString(atMidnightWita), '2026-11-23');
  assert.equal(toLocalDateString(atMidnightWita), '2026-11-23');

  // Early morning WITA (2026-11-23 02:30:00 WITA, UTC is 2026-11-22 18:30:00Z)
  const earlyMorningWita = new Date('2026-11-22T18:30:00.000Z');
  assert.equal(toOperationalDateString(earlyMorningWita), '2026-11-23');

  // End of WITA day (2026-11-23 23:59:59.999 WITA)
  const endOfDayWita = new Date('2026-11-23T15:59:59.999Z');
  assert.equal(toOperationalDateString(endOfDayWita), '2026-11-23');

  // Next WITA midnight (2026-11-24 00:00:00.000 WITA)
  const nextMidnightWita = new Date('2026-11-23T16:00:00.000Z');
  assert.equal(toOperationalDateString(nextMidnightWita), '2026-11-24');
});

test('operational day start and end boundaries map to exact UTC instants for WITA', () => {
  const start = startOfOperationalDay('2026-11-23');
  const end = endOfOperationalDay('2026-11-23');

  assert.equal(start.toISOString(), '2026-11-22T16:00:00.000Z');
  assert.equal(end.toISOString(), '2026-11-23T15:59:59.999Z');
  assert.equal(end.getTime() - start.getTime(), 24 * 60 * 60 * 1000 - 1);
  assert.equal(addDaysToDateString('2026-11-23', 3), '2026-11-26');
  assert.equal(addDaysToDateString('2026-11-23', -1), '2026-11-22');
});

test('operational date utilities return identical results under different host TZ settings', () => {
  const script = `
    import { toOperationalDateString, startOfOperationalDay, endOfOperationalDay } from './backend/lib/format.mjs';
    const sample = new Date('2026-11-22T18:30:00.000Z');
    console.log(JSON.stringify({
      operationalDate: toOperationalDateString(sample),
      startIso: startOfOperationalDay('2026-11-23').toISOString(),
      endIso: endOfOperationalDay('2026-11-23').toISOString(),
    }));
  `;

  const expected = {
    operationalDate: '2026-11-23',
    startIso: '2026-11-22T16:00:00.000Z',
    endIso: '2026-11-23T15:59:59.999Z',
  };

  for (const tz of ['UTC', 'America/New_York', 'Asia/Makassar']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('../..', import.meta.url),
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    }).trim();
    assert.deepEqual(JSON.parse(out), expected, `Mismatch when TZ=${tz}`);
  }
});
