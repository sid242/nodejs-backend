import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { redis } from '@/config/redis';
import { REDIS_PREFIXES } from '@/constants/index';
import { AppError } from '@/lib/errors';
import * as repo from '@/modules/developers/developers.repository';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

export async function requireApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      AppError.unauthorized(
        'Missing API key in Authorization header (expected Bearer sk_live_...)',
      ),
    );
  }

  const token = authHeader.slice(7).trim();
  if (!token.startsWith('sk_live_')) {
    return next(AppError.unauthorized('Invalid API key format (expected sk_live_...)'));
  }

  const keyHash = crypto.createHash('sha256').update(token).digest('hex');
  const apiKey = await repo.findApiKeyByKeyHash(keyHash);

  if (!apiKey) {
    return next(AppError.unauthorized('Invalid or unrecognised API key'));
  }

  if (apiKey.revokedAt) {
    return next(AppError.unauthorized('This API key has been revoked'));
  }

  if (apiKey.expiresAt && new Date() > new Date(apiKey.expiresAt)) {
    return next(AppError.unauthorized('This API key has expired'));
  }

  // IP Allowlist Enforcement
  const clientIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
  if (apiKey.allowedIps && apiKey.allowedIps.length > 0) {
    const isAllowed = apiKey.allowedIps.some((allowed) => allowed === clientIp || allowed === '*');
    if (!isAllowed) {
      return next(
        AppError.forbidden(`Client IP ${clientIp} is not authorized to use this API key`),
      );
    }
  }

  // Redis Per-Minute Rate Limiting per Key
  const rateLimitKey = `${REDIS_PREFIXES.RATE_LIMIT}apikey:${apiKey.id}`;
  const currentCount = await redis.incr(rateLimitKey);
  if (currentCount === 1) {
    await redis.expire(rateLimitKey, 60);
  }

  if (currentCount > (apiKey.rateLimitPerMin || 60)) {
    return next(
      AppError.tooManyRequests(
        `API key rate limit exceeded (${apiKey.rateLimitPerMin} req/min). Please slow down.`,
      ),
    );
  }

  // Load bound tenant
  const tenant = await tenantsRepo.findTenantById(apiKey.tenantId);
  if (!tenant || tenant.status !== 'ACTIVE') {
    return next(AppError.forbidden('The workspace bound to this API key is inactive or suspended'));
  }

  // Attach context to Request
  req.apiKey = {
    id: apiKey.id,
    name: apiKey.name,
    prefix: apiKey.prefix,
    scopes: apiKey.scopes,
    tenantId: apiKey.tenantId,
  };

  req.tenant = {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    plan: tenant.plan,
    databaseMode: tenant.databaseMode as any,
  };

  req.tenantId = tenant.id;
  req.permissions = apiKey.scopes;

  // Asynchronously record last used timestamp and IP
  void repo.updateApiKeyUsage(apiKey.id, clientIp).catch(() => {});

  next();
}

/**
 * Middleware ensuring caller's API key possesses a required permission scope.
 */
export function requireApiKeyScope(scope: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      return next(AppError.unauthorized('API key authentication required'));
    }

    const hasScope = req.apiKey.scopes.includes(scope) || req.apiKey.scopes.includes('*');
    if (!hasScope) {
      return next(
        AppError.forbidden(`This API key lacks the required permission scope: "${scope}"`),
      );
    }

    next();
  };
}
