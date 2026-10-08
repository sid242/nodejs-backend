import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { env } from './config/env.js';
import { parseList } from './lib/utils.js';
import { httpLogger } from './middleware/http-logger.js';
import { errorHandler, notFound } from './middleware/error.js';
import { globalLimiter } from './middleware/rate-limit.js';
import { basicAuth } from './middleware/basic-auth.js';
import { metricsMiddleware, metricsRouter } from './observability/metrics.js';
import { bullBoardRouter } from './queues/bull-board.js';
import { docsRouter } from './docs/index.js';
import healthRoutes from './modules/health/health.routes.js';
import apiRoutes from './routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY); // correct client IP behind ALB/nginx (needed for rate limiting)

  app.use(httpLogger);
  app.use(metricsMiddleware);

  app.use('/health', healthRoutes);
  app.use('/metrics', metricsRouter);

  // Interactive Swagger UI & OpenAPI spec (mounted before helmet: UI uses inline assets)
  app.use('/docs', docsRouter());

  // Queue dashboard (mounted before helmet: its UI uses inline assets). Off unless a password is set.
  if (env.BULL_BOARD_PASSWORD)
    app.use('/admin/queues', basicAuth, bullBoardRouter('/admin/queues'));

  app.use(helmet());
  app.use(cors({ origin: parseList(env.CORS_ORIGINS), credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1', globalLimiter, apiRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
