import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { env } from '@/config/env';
import { docsRouter } from '@/docs/index';
import { parseList } from '@/lib/utils';
import { basicAuth } from '@/middleware/basic-auth';
import { errorHandler, notFound } from '@/middleware/error';
import { httpLogger } from '@/middleware/http-logger';
import { globalLimiter } from '@/middleware/rate-limit';
import healthRoutes from '@/modules/health/health.routes';
import { metricsMiddleware, metricsRouter } from '@/observability/metrics';
import { bullBoardRouter } from '@/queues/bull-board';
import apiRoutes from '@/routes';

export function createApp(): Express {
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
  if (env.BULL_BOARD_PASSWORD) {
    app.use('/admin/queues', basicAuth, bullBoardRouter('/admin/queues'));
  }

  app.use(helmet());
  app.use(cors({ origin: parseList(env.CORS_ORIGINS), credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/v1', globalLimiter, apiRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
