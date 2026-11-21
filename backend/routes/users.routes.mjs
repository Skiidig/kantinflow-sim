import { Router } from 'express';
import { MongoServerError } from 'mongodb';
import { ApiError } from '../api-error.mjs';
import { escapeRegex, parseObjectId } from '../lib/format.mjs';
import { ROLES } from '../middleware/auth.mjs';
import { hashPassword } from '../password.mjs';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const ALLOWED_ROLES = new Set([ROLES.ADMIN, ROLES.PETUGAS]);

function serializeUser(user) {
  return {
    id: user._id.toHexString(),
    name: user.name ?? null,
    email: user.email,
    role: user.role,
    isActive: user.isActive === true,
    createdAt: user.createdAt ?? null,
    updatedAt: user.updatedAt ?? null,
  };
}

export function createUsersRouter({ db, authenticate, authorize }) {
  const router = Router();
  const users = db.collection('users');

  router.use(authenticate, authorize(ROLES.ADMIN));

  router.get('/', async (req, res) => {
    const filter = {};
    const { role, isActive, q } = req.query;

    if (typeof role === 'string' && role.trim() !== '') {
      const normalizedRole = role.trim().toLowerCase();
      if (!ALLOWED_ROLES.has(normalizedRole)) {
        throw new ApiError(400, 'VALIDATION_ERROR', { role: 'Peran harus admin atau petugas' });
      }
      filter.role = normalizedRole;
    }

    if (typeof isActive === 'string' && isActive.trim() !== '') {
      if (isActive === 'true') filter.isActive = true;
      else if (isActive === 'false') filter.isActive = false;
      else throw new ApiError(400, 'VALIDATION_ERROR', { isActive: 'Status harus true atau false' });
    }

    if (typeof q === 'string' && q.trim() !== '') {
      const regex = new RegExp(escapeRegex(q.trim()), 'iu');
      filter.$or = [{ name: regex }, { email: regex }];
    }

    const docs = await users
      .find(filter, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    res.json({ data: docs.map(serializeUser) });
  });

  router.post('/', async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw new ApiError(400, 'VALIDATION_ERROR', { body: 'Isi permintaan harus berupa objek JSON' });
    }

    const { name, email, password, role = ROLES.PETUGAS } = req.body;
    const fields = {};

    if (typeof name !== 'string' || name.trim() === '') {
      fields.name = 'Nama wajib diisi';
    } else if (name.trim().length > 120) {
      fields.name = 'Nama maksimal 120 karakter';
    }

    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalizedEmail) {
      fields.email = 'Email wajib diisi';
    } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
      fields.email = 'Format email tidak valid';
    }

    if (typeof password !== 'string' || password.length < 6) {
      fields.password = 'Password minimal 6 karakter';
    } else if (password.length > 128) {
      fields.password = 'Password maksimal 128 karakter';
    }

    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
    if (!ALLOWED_ROLES.has(normalizedRole)) {
      fields.role = 'Peran harus admin atau petugas';
    }

    if (Object.keys(fields).length) {
      throw new ApiError(400, 'VALIDATION_ERROR', fields);
    }

    const existing = await users.findOne({ email: normalizedEmail }, { projection: { _id: 1 } });
    if (existing) {
      throw new ApiError(409, 'EMAIL_EXISTS', { email: 'Email sudah terdaftar' });
    }

    const now = new Date();
    const passwordHash = await hashPassword(password);
    const doc = {
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: normalizedRole,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const { insertedId } = await users.insertOne(doc);
      res.status(201).json({ data: serializeUser({ _id: insertedId, ...doc }) });
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) {
        throw new ApiError(409, 'EMAIL_EXISTS', { email: 'Email sudah terdaftar' });
      }
      throw err;
    }
  });

  router.patch('/:id', async (req, res) => {
    const userId = parseObjectId(req.params.id, 'USER_NOT_FOUND');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw new ApiError(400, 'VALIDATION_ERROR', { body: 'Isi permintaan harus berupa objek JSON' });
    }

    const updates = {};
    const fields = {};

    if ('name' in req.body) {
      if (typeof req.body.name !== 'string' || req.body.name.trim() === '') {
        fields.name = 'Nama wajib diisi';
      } else if (req.body.name.trim().length > 120) {
        fields.name = 'Nama maksimal 120 karakter';
      } else {
        updates.name = req.body.name.trim();
      }
    }

    if ('isActive' in req.body) {
      if (typeof req.body.isActive !== 'boolean') {
        fields.isActive = 'Status aktif harus berupa boolean';
      } else {
        if (req.body.isActive === false && userId.equals(req.actorId)) {
          throw new ApiError(409, 'CANNOT_DEACTIVATE_SELF');
        }
        updates.isActive = req.body.isActive;
      }
    }

    if (Object.keys(fields).length) {
      throw new ApiError(400, 'VALIDATION_ERROR', fields);
    }
    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', { body: 'Minimal satu kolom yang valid harus diisi' });
    }

    updates.updatedAt = new Date();
    const updated = await users.findOneAndUpdate(
      { _id: userId },
      { $set: updates },
      { returnDocument: 'after', projection: { passwordHash: 0 } },
    );
    if (!updated) throw new ApiError(404, 'USER_NOT_FOUND');

    res.json({ data: serializeUser(updated) });
  });

  return router;
}
