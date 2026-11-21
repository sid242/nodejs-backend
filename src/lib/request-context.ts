import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';

export interface RequestContextStore {
  clientHost?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContextStore>();

export function getClientHost(): string | undefined {
  return requestContext.getStore()?.clientHost;
}

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const rawClientHost =
    (req.headers['x-client-host'] as string | undefined) ||
    (req.headers['x-forwarded-host'] as string | undefined) ||
    (req.headers['host'] as string | undefined);

  const clientHost = rawClientHost?.split(',')?.[0]?.trim();

  requestContext.run({ clientHost }, () => {
    next();
  });
}
