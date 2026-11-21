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

export function toLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToDateString(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
