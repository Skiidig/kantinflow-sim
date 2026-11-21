import { Router } from 'express';
import { ApiError } from '../api-error.mjs';
import { ROLES } from '../middleware/auth.mjs';
import {
  createItem,
  deleteOrArchiveItem,
  getItemById,
  listItemBatches,
  listItems,
  updateItem,
} from '../services/items.service.mjs';

export function createItemsRouter({ client, db, authenticate, authorize }) {
  const router = Router();
  const canRead = authorize(ROLES.ADMIN, ROLES.PETUGAS);
  const adminOnly = authorize(ROLES.ADMIN);

  router.use(authenticate);

  router.get('/', canRead, async (req, res) => {
    const result = await listItems(db, req.query);
    res.json(result);
  });

  router.get('/:id', canRead, async (req, res) => {
    const item = await getItemById(db, req.params.id);
    res.json({ data: item });
  });

  router.get('/:id/batches', canRead, async (req, res) => {
    const onlyRemainingParam = typeof req.query.onlyRemaining === 'string'
      ? req.query.onlyRemaining.trim().toLowerCase()
      : '';
    if (onlyRemainingParam && onlyRemainingParam !== 'true' && onlyRemainingParam !== 'false') {
      throw new ApiError(400, 'VALIDATION_ERROR', {
        onlyRemaining: 'Parameter onlyRemaining harus true atau false',
      });
    }

    const data = await listItemBatches(db, req.params.id, {
      role: req.actor.role,
      onlyRemaining: onlyRemainingParam === 'true',
    });
    res.json({ data });
  });

  router.post('/', adminOnly, async (req, res) => {
    const item = await createItem(db, req.body);
    res.status(201).json({ data: item });
  });

  router.patch('/:id', adminOnly, async (req, res) => {
    const item = await updateItem({ client, db }, req.params.id, req.body);
    res.json({ data: item });
  });

  router.delete('/:id', adminOnly, async (req, res) => {
    const result = await deleteOrArchiveItem({ client, db }, req.params.id);
    if (result.status === 204) {
      return res.status(204).end();
    }
    return res.status(result.status).json({ data: result.data });
  });

  return router;
}
