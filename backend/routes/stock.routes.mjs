import { Router } from 'express';
import { ApiError } from '../api-error.mjs';
import { ROLES } from '../middleware/auth.mjs';
import { saveReceipt } from '../receipt-store.mjs';
import { validateReceipt } from '../validate-receipt.mjs';

export function createStockRouter({ client, db, authenticate, authorize }) {
  const router = Router();

  router.post(
    '/receipts',
    authenticate,
    authorize(ROLES.ADMIN, ROLES.PETUGAS),
    async (req, res) => {
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
    },
  );

  return router;
}
