import { createHash } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

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

  // Update last used timestamp in background
  ssoRepo.updateScimTokenLastUsed(tokenRecord.id).catch(() => {});

  // Attach tenant context
  req.tenantId = tokenRecord.tenantId;
  next();
}

