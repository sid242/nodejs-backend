import type { Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { redis } from '@/config/redis';
import { logSecurityEvent } from '@/modules/audit/audit.service';

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
            : typeof req.query?.email === 'string'
              ? req.query.email
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
    handler: (req: Request, res: Response) => {
      const retryAfter = Math.ceil((windowMs ?? 60_000) / 1000);
      res.setHeader('Retry-After', retryAfter);

      logger.warn(
        {
          limiter: name,
          ip: req.ip,
          path: req.originalUrl || req.path,
          method: req.method,
          tenantId: req.tenant?.id,
          userId: req.user?.id,
        },
        'Rate limit exceeded',
      );

      void logSecurityEvent({
        tenantId: req.tenant?.id ?? null,
        userId: req.user?.id ?? null,
        action: 'SECURITY.RATE_LIMIT_EXCEEDED',
        entityType: 'RateLimiter',
        metadata: {
          limiter: name,
          ip: req.ip,
          path: req.originalUrl || req.path,
          method: req.method,
        },
      }).catch(() => {});

      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests, please slow down and try again later.',
        },
        requestId: req.id,
      });
    },
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

// Geo lookups and hierarchy resolution
export const geoLimiter = make({ name: 'geo', limit: 180, byUser: true });

// Address mutations
export const addressLimiter = make({ name: 'addresses', limit: 60, byUser: true });

// SSO discovery, initiate, lookup, and ACS callbacks
export const ssoLimiter = make({
  name: 'sso',
  limit: 20,
  windowMs: 60_000,
  compositeAuth: true,
});

// Single-use authentication handoff token redemption
export const handoffRedeemLimiter = make({
  name: 'handoff',
  limit: 10,
  windowMs: 60_000,
});

// Public tenant resolution (slug / custom domain checks)
export const resolveLimiter = make({
  name: 'resolve',
  limit: 60,
  windowMs: 60_000,
});

// Notifications queries and mutations
export const notificationLimiter = make({
  name: 'notification',
  limit: 120,
  byUser: true,
});

// Fast debounced search queries
export const searchLimiter = make({
  name: 'search',
  limit: 180,
  byUser: true,
});

// Caddy / internal reverse-proxy TLS verification ask queries
export const internalLimiter = make({
  name: 'internal',
  limit: 60,
  windowMs: 60_000,
});

// Public membership tiers & pricing catalog queries
export const billingPublicLimiter = make({
  name: 'billing-public',
  limit: 30,
  windowMs: 60_000,
});

// SCIM 2.0 directory sync rate limiter (RFC 7644 compliant 429 response)
export const scimLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  passOnStoreError: true,
  store: new RedisStore({
    sendCommand: ((...args: string[]) => (redis as any).call(...args)) as any,
    prefix: 'rl:scim:',
  }),
  keyGenerator: (req: Request) => {
    return req.tenantId ? `t:${req.tenantId}` : `ip:${req.ip || 'anonymous'}`;
  },
  handler: (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
    res.status(429).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '429',
      detail: 'Too many requests. SCIM rate limit exceeded (100 req/min). Please retry after cooldown.',
    });
  },
});
