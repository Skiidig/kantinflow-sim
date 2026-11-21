import { Router } from 'express';
import { ApiError } from '../api-error.mjs';
import { ROLES } from '../middleware/auth.mjs';
import { saveReceipt } from '../receipt-store.mjs';
import { recordDisposal, validateDisposal } from '../services/disposal.service.mjs';
import { recordUsage, validateUsage } from '../services/usage.service.mjs';
import { validateReceipt } from '../validate-receipt.mjs';

export function createStockRouter({ client, db, authenticate, authorize }) {
  const router = Router();
  const canOperate = [authenticate, authorize(ROLES.ADMIN, ROLES.PETUGAS)];

  router.post('/receipts', ...canOperate, async (req, res) => {
    const fields = validateReceipt(req.body);
    const key = req.get('Idempotency-Key');
    if (!key || key.length > 128) fields.idempotencyKey = 'Isi Idempotency-Key yang valid';
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', fields);

    const { status, data } = await saveReceipt({
      client,
      db,
      actorId: req.actorId,
      key,
      body: req.body,
    });
    res.status(status).json({ data });
  });

  router.post('/usages', ...canOperate, async (req, res) => {
    const fields = validateUsage(req.body);
    const rawKey = req.get('Idempotency-Key');
    if (rawKey !== undefined && (rawKey.trim() === '' || rawKey.length > 128)) {
      fields.idempotencyKey = 'Isi Idempotency-Key yang valid';
    }
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', fields);

    const { status, data } = await recordUsage({
      client,
      db,
      actorId: req.actorId,
      key: rawKey,
      body: req.body,
    });
    res.status(status).json({ data });
  });

  router.post('/disposals', ...canOperate, async (req, res) => {
    const fields = validateDisposal(req.body);
    const rawKey = req.get('Idempotency-Key');
    if (rawKey !== undefined && (rawKey.trim() === '' || rawKey.length > 128)) {
      fields.idempotencyKey = 'Isi Idempotency-Key yang valid';
    }
    if (Object.keys(fields).length) throw new ApiError(400, 'VALIDATION_ERROR', fields);

    const { status, data } = await recordDisposal({
      client,
      db,
      actorId: req.actorId,
      key: rawKey,
      body: req.body,
    });
    res.status(status).json({ data });
  });

  return router;
}
