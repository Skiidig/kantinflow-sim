import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/u;

export async function hashPassword(password) {
  if (typeof password !== 'string' || password === '') {
    throw new TypeError('Password wajib diisi');
  }
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  if (!BCRYPT_HASH_PATTERN.test(stored)) return false;
  try {
    return await bcrypt.compare(password, stored);
  } catch {
    return false;
  }
}
