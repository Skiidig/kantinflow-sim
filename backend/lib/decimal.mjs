import { Decimal128 } from 'mongodb';
import { canonicalDecimal } from './format.mjs';

const SIGNED_DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/u;

function parseScaled(input) {
  const str = String(input).trim();
  const match = SIGNED_DECIMAL_PATTERN.exec(str);
  if (!match) {
    throw new TypeError(`Invalid decimal value: ${str}`);
  }
  const sign = match[1] ? -1n : 1n;
  const intPart = match[2];
  const fracPart = match[3] ?? '';
  const scale = fracPart.length;
  const digits = BigInt(intPart + fracPart);
  return { value: digits === 0n ? 0n : sign * digits, scale };
}

function align(a, b) {
  const pa = parseScaled(a);
  const pb = parseScaled(b);
  const scale = Math.max(pa.scale, pb.scale);
  const va = pa.value * (10n ** BigInt(scale - pa.scale));
  const vb = pb.value * (10n ** BigInt(scale - pb.scale));
  return { va, vb, scale };
}

function formatScaled(value, scale) {
  if (value === 0n) return '0';
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  let unsigned;
  if (scale === 0) {
    unsigned = digits;
  } else {
    const padded = digits.padStart(scale + 1, '0');
    const intPart = padded.slice(0, padded.length - scale);
    const fracPart = padded.slice(padded.length - scale);
    unsigned = canonicalDecimal(`${intPart}.${fracPart}`);
  }
  return negative ? `-${unsigned}` : unsigned;
}

export function compareDecimals(a, b) {
  const { va, vb } = align(a, b);
  if (va < vb) return -1;
  if (va > vb) return 1;
  return 0;
}

export function addDecimals(a, b) {
  const { va, vb, scale } = align(a, b);
  return formatScaled(va + vb, scale);
}

export function subDecimals(a, b) {
  const { va, vb, scale } = align(a, b);
  return formatScaled(va - vb, scale);
}

export function mulDecimals(a, b) {
  const pa = parseScaled(a);
  const pb = parseScaled(b);
  return formatScaled(pa.value * pb.value, pa.scale + pb.scale);
}

export function negateDecimal(a) {
  const pa = parseScaled(a);
  return formatScaled(-pa.value, pa.scale);
}

export function absDecimal(a) {
  const pa = parseScaled(a);
  return formatScaled(pa.value < 0n ? -pa.value : pa.value, pa.scale);
}

export function toDecimal128(value) {
  const pa = parseScaled(value);
  return Decimal128.fromString(formatScaled(pa.value, pa.scale));
}
