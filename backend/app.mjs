import express from 'express';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { ApiError } from './api-error.mjs';
import { verifyPassword } from './password.mjs';
import { validateReceipt } from './validate-receipt.mjs';
import { saveReceipt } from './receipt-store.mjs';

export function createApp({ client, db, jwtSecret, tokenTtl = '8h' }) {
  const app = express();
  app.use(express.json({ limit: '16kb' }));

  app.post('/api/v1/auth/login', async (req, res) => {
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

  app.post('/api/v1/stock/receipts', async (req, res) => {
    const token = /^Bearer (\S+)$/i.exec(req.get('Authorization') ?? '')?.[1];
    let claims;
    try {
      claims = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw new ApiError(401, 'UNAUTHENTICATED');
    }
    if (typeof claims.sub !== 'string' || !/^[a-f0-9]{24}$/i.test(claims.sub)) {
      throw new ApiError(401, 'UNAUTHENTICATED');
    }
    const actorId = new ObjectId(claims.sub);
    const actor = await db.collection('users').findOne({ _id: actorId, isActive: true });
    if (!actor) throw new ApiError(401, 'UNAUTHENTICATED');
    if (!['admin', 'staff'].includes(actor.role)) throw new ApiError(403, 'FORBIDDEN');

    const fields = validateReceipt(req.body);
    const key = req.get('Idempotency-Key');
    if (!key || key.length > 128) fields.idempotencyKey = 'Isi Idempotency-Key yang valid';
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', fields);

    const { status, data } = await saveReceipt({ client, db, actorId, key, body: req.body });
    res.status(status).json({ data });
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ApiError) {
      const error = { code: err.code };
      if (err.fields) error.fields = err.fields;
      return res.status(err.status).json({ error });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON' } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE' } });
    }
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
  });
  return app;
}
