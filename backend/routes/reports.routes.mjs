import { Router } from 'express';
import { ROLES } from '../middleware/auth.mjs';
import { getDisposalReport } from '../services/disposal.service.mjs';

export function createReportsRouter({ db, authenticate, authorize }) {
  const router = Router();

  router.use(authenticate, authorize(ROLES.ADMIN));

  router.get('/disposals', async (req, res) => {
    const data = await getDisposalReport(db, req.query);
    res.json({ data });
  });

  return router;
}
