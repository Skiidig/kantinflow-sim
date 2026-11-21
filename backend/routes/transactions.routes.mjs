import { Router } from 'express';
import { ROLES } from '../middleware/auth.mjs';
import { listTransactions } from '../services/transactions.service.mjs';

export function createTransactionsRouter({ db, authenticate, authorize }) {
  const router = Router();

  router.get('/', authenticate, authorize(ROLES.ADMIN, ROLES.PETUGAS), async (req, res) => {
    const result = await listTransactions(db, req.query, { role: req.actor.role });
    res.json(result);
  });

  return router;
}
