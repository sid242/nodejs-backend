import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import { logger } from '../config/logger.js';

export const httpLogger = pinoHttp({
  logger,
  // Reuse the LB/proxy request id when present so a request can be traced across services.
  genReqId: (req, res) => {
    const id = req.headers['x-request-id'] || randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  autoLogging: { ignore: (req) => req.url.startsWith('/health') || req.url === '/metrics' },
  customLogLevel: (_req, res, err) =>
    err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  customProps: (req) => ({ userId: req.user?.id }),
});
