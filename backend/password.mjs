import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_BYTES = 64;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SCHEME = 'scrypt';

// Format tersimpan: scrypt$N$r$p$saltHex$hashHex
export async function hashPassword(password) {
  if (typeof password !== 'string' || password === '') {
    throw new TypeError('Password wajib diisi');
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_BYTES, PARAMS);
  return [
    SCHEME, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('hex'), derived.toString('hex'),
  ].join('$');
}

function parseStoredHash(stored) {
  if (typeof stored !== 'string') return null;
  const [scheme, n, r, p, saltHex, hashHex, ...extra] = stored.split('$');
  if (scheme !== SCHEME || extra.length !== 0 || !saltHex || !hashHex) return null;
  if (!/^[a-f0-9]{32}$/iu.test(saltHex) || !/^[a-f0-9]+$/iu.test(hashHex)) return null;
  if (Number(n) !== PARAMS.N || Number(r) !== PARAMS.r || Number(p) !== PARAMS.p) return null;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEY_BYTES) return null;
  return { salt: Buffer.from(saltHex, 'hex'), expected };
}

export async function verifyPassword(password, stored) {
  const parsed = parseStoredHash(stored);
  if (!parsed || typeof password !== 'string') return false;
  try {
    const actual = await scrypt(password, parsed.salt, parsed.expected.length, PARAMS);
    return timingSafeEqual(actual, parsed.expected);
  } catch {
    return false;
  }
}
