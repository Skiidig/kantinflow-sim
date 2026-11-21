import express from 'express';
import { authorize, createAuthenticate } from './middleware/auth.mjs';
import { createCorsMiddleware } from './middleware/cors.mjs';
import { errorHandler } from './middleware/error-handler.mjs';
import { createAuthRouter } from './routes/auth.routes.mjs';
import { createDashboardRouter } from './routes/dashboard.routes.mjs';
import { createItemsRouter } from './routes/items.routes.mjs';
import { createReportsRouter } from './routes/reports.routes.mjs';
import { createStockRouter } from './routes/stock.routes.mjs';
import { createTransactionsRouter } from './routes/transactions.routes.mjs';
import { createUsersRouter } from './routes/users.routes.mjs';

export function createApp({
  client,
  db,
  jwtSecret,
  tokenTtl = '8h',
  corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173',
}) {
  const app = express();
  app.use(createCorsMiddleware(corsOrigin));
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/v1/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const authenticate = createAuthenticate({ db, jwtSecret });

  app.use('/api/v1/auth', createAuthRouter({ db, jwtSecret, tokenTtl }));
  app.use('/api/v1/users', createUsersRouter({ db, authenticate, authorize }));
  app.use('/api/v1/items', createItemsRouter({ client, db, authenticate, authorize }));
  app.use('/api/v1/stock', createStockRouter({ client, db, authenticate, authorize }));
  app.use('/api/v1/dashboard', createDashboardRouter({ db, authenticate, authorize }));
  app.use('/api/v1/transactions', createTransactionsRouter({ db, authenticate, authorize }));
  app.use('/api/v1/reports', createReportsRouter({ db, authenticate, authorize }));

  app.use(errorHandler);
  return app;
}
