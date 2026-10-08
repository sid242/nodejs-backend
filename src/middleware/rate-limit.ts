import type { Request, Response, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '@/config/redis.js';
import { env } from '@/config/env.js';

export interface RateLimiterOptions {
  name: string;
  windowMs?: number;
  limit: number;
  byUser?: boolean;
}

/**
 * Redis-backed so limits are shared across ALL API replicas.
 * passOnStoreError: if Redis is down we fail open rather than take the API down.
 */
const make = ({
  name,
  windowMs = env.RATE_LIMIT_WINDOW_MS,
  limit,
  byUser = false,
}: RateLimiterOptions): RequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    passOnStoreError: true,
    keyGenerator: (req: Request) =>
      byUser && req.user?.id ? `u:${req.user.id}` : req.ip || 'anonymous',
    store: new RedisStore({
      sendCommand: (...args: string[]) => (redis as any).call(...args),
      prefix: `rl:${name}:`,
    }),
    handler: (req: Request, res: Response) =>
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' },
        requestId: req.id,
      }),
  });

export const globalLimiter = make({ name: 'global', limit: env.RATE_LIMIT_MAX });
// Brute-force protection for login/register/refresh.
export const authLimiter = make({
  name: 'auth',
  limit: env.AUTH_RATE_LIMIT_MAX,
  windowMs: 15 * 60_000,
});
// Per-user limit for expensive endpoints (must run after requireAuth).
export const uploadLimiter = make({ name: 'upload', limit: 30, byUser: true });
