import { createHash } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

import { logger } from '@/config/logger';
import { runWithTenantDb } from '@/db/tenancy/context';
import { getTenantDb } from '@/db/tenancy/tenant-db';
import { ssoRepo } from '@/modules/sso/sso.repository';

export async function requireScimAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'Missing or malformed Authorization Bearer header',
    });
    return;
  }

  const rawToken = authHeader.slice(7).trim();
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  const tokenRecord = await ssoRepo.findScimTokenByHash(tokenHash);
  if (!tokenRecord || tokenRecord.status !== 'ACTIVE') {
    res.status(401).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'Invalid or revoked SCIM bearer token',
    });
    return;
  }

  if (tokenRecord.expiresAt && tokenRecord.expiresAt.getTime() < Date.now()) {
    res.status(401).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'SCIM bearer token has expired',
    });
    return;
  }

  const clientIp = (req.ip || req.socket.remoteAddress || '').replace(/^.*:/, '');

  // IP Allow-List Enforcement
  const allowedIps = (tokenRecord as any).allowedIps as string[] | undefined;
  if (allowedIps && allowedIps.length > 0) {
    const isAllowed = allowedIps.some((allowed) => allowed.trim() === clientIp);
    if (!isAllowed) {
      logger.warn(
        { tokenId: tokenRecord.id, tenantId: tokenRecord.tenantId, clientIp, allowedIps },
        'SCIM request rejected: client IP not in allow-list',
      );
      res.status(403).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '403',
        detail: `Client IP ${clientIp} is not authorized for this SCIM bearer token`,
      });
      return;
    }
  }

  // Detect IP change and audit
  if (tokenRecord.lastUsedAt && (tokenRecord as any).lastUsedIp && (tokenRecord as any).lastUsedIp !== clientIp) {
    logger.info(
      { tokenId: tokenRecord.id, tenantId: tokenRecord.tenantId, oldIp: (tokenRecord as any).lastUsedIp, newIp: clientIp },
      'SCIM bearer token used from new IP address',
    );
  }

  // Update last used timestamp and IP in background
  ssoRepo.updateScimTokenLastUsed(tokenRecord.id, clientIp).catch(() => {});

  // Attach tenant context strictly from verified token
  req.tenantId = tokenRecord.tenantId;

  // Resolve tenant database connection
  try {
    const tenantDbHandle = await getTenantDb({
      id: tokenRecord.tenantId,
      databaseMode: 'shared',
    });
    req.db = tenantDbHandle;

    return runWithTenantDb(
      {
        tenantId: tokenRecord.tenantId,
        db: tenantDbHandle,
        databaseMode: 'shared',
      },
      () => next(),
    );
  } catch (err) {
    next(err);
  }
}

