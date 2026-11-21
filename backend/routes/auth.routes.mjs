import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError } from '../api-error.mjs';
import { verifyPassword } from '../password.mjs';

export function createAuthRouter({ db, jwtSecret, tokenTtl = '8h' }) {
  const router = Router();

  router.post('/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    const fields = {};
    if (typeof email !== 'string' || email.trim() === '') fields.email = 'Email wajib diisi';
    if (typeof password !== 'string' || password === '') fields.password = 'Password wajib diisi';
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', fields);

    const user = await db.collection('users').findOne({ email: email.trim().toLowerCase() });
    const passwordMatches = await verifyPassword(password, user?.passwordHash);
    // Email tidak dikenal, password salah, dan akun nonaktif sengaja memakai respons yang sama.
    if (!user || !passwordMatches || user.isActive !== true) {
      throw new ApiError(401, 'INVALID_CREDENTIALS');
    }

    const token = jwt.sign({ role: user.role }, jwtSecret, {
      algorithm: 'HS256',
      subject: user._id.toHexString(),
      expiresIn: tokenTtl,
    });
    res.set('Cache-Control', 'no-store').json({
      data: {
        token,
        user: {
          id: user._id.toHexString(),
          name: user.name ?? null,
          email: user.email,
          role: user.role,
        },
      },
    });
  });

  return router;
}
