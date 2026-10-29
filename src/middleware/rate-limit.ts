import type { Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

import { env } from '@/config/env';
import { redis } from '@/config/redis';

export interface RateLimiterOptions {
  name: string;
  windowMs?: number;
  limit: number;
  byUser?: boolean;
  byTenant?: boolean;
  compositeAuth?: boolean;
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
  byTenant = false,
  compositeAuth = false,
}: RateLimiterOptions): RequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    passOnStoreError: true,
    keyGenerator: (req: Request) => {
      // 1. Composite Auth: IP + normalized email to prevent office NAT lockout and targeted account attacks
      if (compositeAuth) {
        const rawEmail =
          typeof req.body?.email === 'string'
            ? req.body.email
            : typeof req.body?.identifier === 'string'
              ? req.body.identifier
              : '';
        const email = rawEmail.trim().toLowerCase();
        const ip = req.ip || 'anonymous';
        return email ? `${ip}:${email}` : ip;
      }

      // 2. Tenant-scoped: isolates rate limits between workspace tenants
      if (byTenant && req.tenant?.id) {
        if (req.user?.id) {
          return `t:${req.tenant.id}:u:${req.user.id}`;
        }
        return `t:${req.tenant.id}:${req.ip || 'anonymous'}`;
      }

      // 3. User-scoped: throttles by authenticated user (preserves impersonation attribution)
      if (byUser) {
        if (req.impersonator?.userId) {
          return `imp:${req.impersonator.userId}`;
        }
        if (req.user?.id) {
          return `u:${req.user.id}`;
        }
      }

      // Default: IP-based
      return req.ip || 'anonymous';
    },
    store: new RedisStore({
      sendCommand: (...args: string[]) => (redis as any).call(...args),
      prefix: `rl:${name}:`,
    }),
    handler: (req: Request, res: Response) =>
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests, please slow down and try again later.',
        },
        requestId: req.id,
      }),
  });

export const globalLimiter = make({ name: 'global', limit: env.RATE_LIMIT_MAX });

// Brute-force & credential-stuffing protection for login/register/refresh using composite IP + Email
export const authLimiter = make({
  name: 'auth',
  limit: env.AUTH_RATE_LIMIT_MAX,
  windowMs: 15 * 60_000,
  compositeAuth: true,
});

// Per-user limit for expensive endpoints (must run after requireAuth).
export const uploadLimiter = make({ name: 'upload', limit: 30, byUser: true });

// Tenant-level rate limiter for heavy workspace operations
export const tenantLimiter = make({ name: 'tenant', limit: 120, byTenant: true });
