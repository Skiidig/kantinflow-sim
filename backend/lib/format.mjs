import { Decimal128, ObjectId } from 'mongodb';
import { ApiError } from '../api-error.mjs';

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/u;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/iu;

export function isNonNegativeDecimalString(value) {
  return typeof value === 'string' && DECIMAL_PATTERN.test(value);
}

export function normalizeDecimalInput(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return null;
}

export function canonicalDecimal(value) {
  const str = String(value);
  if (!DECIMAL_PATTERN.test(str)) return str;
  const [integer, fraction = ''] = str.split('.');
  const whole = integer.replace(/^0+(?=\d)/u, '');
  const decimals = fraction.replace(/0+$/u, '');
  return decimals ? `${whole}.${decimals}` : whole;
}

export function decimalToString(value) {
  if (value === null || value === undefined) return '0';
  return canonicalDecimal(value.toString());
}

export function isPositiveDecimal(value) {
  return /[1-9]/u.test(decimalToString(value));
}

export function asDecimal128(value, field) {
  try {
    return Decimal128.fromString(canonicalDecimal(value));
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', { [field]: 'Angka di luar batas yang didukung' });
  }
}

export function parseObjectId(value, errorCode = 'NOT_FOUND') {
  if (typeof value !== 'string' || !OBJECT_ID_PATTERN.test(value)) {
    throw new ApiError(404, errorCode);
  }
  return new ObjectId(value);
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export const OPERATIONAL_TIMEZONE = 'Asia/Makassar';
const OPERATIONAL_UTC_OFFSET = '+08:00';

const operationalDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: OPERATIONAL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function toOperationalDateString(date = new Date()) {
  const parts = operationalDateFormatter.formatToParts(date);
  let year = '';
  let month = '';
  let day = '';
  for (const part of parts) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
  }
  return `${year}-${month}-${day}`;
}

export function toLocalDateString(date = new Date()) {
  return toOperationalDateString(date);
}

export function startOfOperationalDay(dateStr) {
  return new Date(`${dateStr}T00:00:00.000${OPERATIONAL_UTC_OFFSET}`);
}

export function endOfOperationalDay(dateStr) {
  return new Date(`${dateStr}T23:59:59.999${OPERATIONAL_UTC_OFFSET}`);
}

export function addDaysToDateString(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
