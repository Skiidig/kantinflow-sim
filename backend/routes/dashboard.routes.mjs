import { Router } from 'express';
import { ApiError } from '../api-error.mjs';
import { ROLES } from '../middleware/auth.mjs';
import { getDashboardData } from '../services/dashboard.service.mjs';

export function createDashboardRouter({ db, authenticate, authorize }) {
  const router = Router();

  router.get('/', authenticate, authorize(ROLES.ADMIN, ROLES.PETUGAS), async (req, res) => {
    let days = 3;
    if (req.query.days !== undefined && req.query.days !== '') {
      days = Number(req.query.days);
      if (!Number.isInteger(days) || days < 1 || days > 30) {
        throw new ApiError(400, 'VALIDATION_ERROR', {
          days: 'Ambang hari kedaluwarsa harus bilangan bulat antara 1 dan 30',
        });
      }
    }

    const data = await getDashboardData(db, { role: req.actor.role, days });
    res.json({ data });
  });

  return router;
}
