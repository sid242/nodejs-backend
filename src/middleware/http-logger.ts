import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pinoHttp } from 'pino-http';

import { logger } from '@/config/logger';

export function getLogCustomProps(req: any): Record<string, unknown> {
  return {
    userId: req.user?.id,
    tenantId: req.tenant?.id,
    staffId: req.staff?.id ?? req.supportSession?.staffId,
    isSupportSession: Boolean(req.isSupportSession),
  };
}

export const httpLogger = pinoHttp({
  logger,
  // Reuse the LB/proxy request id when present so a request can be traced across services.
  genReqId: (req: IncomingMessage, res: ServerResponse): string => {
    const id = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  autoLogging: {
    ignore: (req: IncomingMessage) =>
      Boolean(
        req.url?.startsWith('/health') || req.url === '/metrics' || req.url?.startsWith('/docs'),
      ),
  },
  customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) =>
    err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  serializers: {
    req: (req: any) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res: any) => ({ statusCode: res.statusCode }),
  },
  customProps: getLogCustomProps,
});
