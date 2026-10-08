import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '@/config/env.js';

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();
const safeEqual = (a: string, b?: string): boolean => {
  if (!b) return false;
  return timingSafeEqual(digest(a), digest(b));
};

export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
    if (
      user &&
      safeEqual(user, env.BULL_BOARD_USER) &&
      safeEqual(rest.join(':'), env.BULL_BOARD_PASSWORD)
    ) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="queues"').status(401).end();
}
