import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ACCESS_TOKEN_COOKIE, AUTH_HEADERS } from '@/constants/index';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import { verifyAccessToken, verifySupportToken } from '@/modules/auth/tokens';
import * as platformRepo from '@/modules/platform/platform.repository';
import { resolveUserPermissions, SYSTEM_ROLES } from '@/modules/rbac/rbac.service';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

export const SUPPORT_TOKEN_COOKIE = 'support_at';

export const SUPPORT_TENANT_PERMISSIONS = [
  'tenants:read',
  'tenants:update',
  'members:read',
  'roles:read',
  'files:read',
  'files:upload',
  'files:delete',
  'email_templates:read',
  'email_templates:manage',
  'branding:read',
  'branding:update',
  'audit:read',
  'billing:read',
] as const;

export async function requireSupportOrUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  let token: string | undefined;

  // 1. Check support cookie first, then auth header, then standard access token cookie
  if (req.cookies?.[SUPPORT_TOKEN_COOKIE]) {
    token = req.cookies[SUPPORT_TOKEN_COOKIE];
  } else {
    const header = req.headers.authorization;
    if (header?.startsWith(AUTH_HEADERS.PREFIX)) {
      token = header.slice(AUTH_HEADERS.PREFIX.length).trim();
    } else if (req.cookies?.[ACCESS_TOKEN_COOKIE]) {
      token = req.cookies[ACCESS_TOKEN_COOKIE];
    }
  }

  if (!token) return next(AppError.unauthorized('Authentication required'));

  // 2. Try verifying as SUPPORT token first
  try {
    const supportPayload = verifySupportToken(token);

    // Fail-closed DB check for support session
    const session = await platformRepo.findSupportSessionById(supportPayload.sess);
    if (!session) {
      return next(AppError.unauthorized('Support session not found or revoked'));
    }

    if (session.status !== 'ACTIVE') {
      return next(AppError.forbidden(`Support session is currently ${session.status.toLowerCase()}`));
    }

    if (new Date(session.expiresAt) <= new Date()) {
      await platformRepo.terminateSupportSession(session.id);
      return next(AppError.unauthorized('Support session has expired'));
    }

    if (session.staffId !== supportPayload.staffId || session.tenantId !== supportPayload.tenantId) {
      return next(AppError.unauthorized('Support session claims mismatch'));
    }

    // Resolve tenant
    const tenant = await tenantsRepo.findTenantById(session.tenantId);
    if (!tenant || tenant.deletedAt) {
      return next(AppError.notFound('Tenant workspace not found'));
    }

    if (tenant.status !== 'ACTIVE' && tenant.status !== 'TRIALING') {
      return next(AppError.forbidden(`Tenant workspace is currently ${tenant.status.toLowerCase()}`));
    }

    req.isSupportSession = true;
    req.supportSession = {
      id: session.id,
      sessionId: session.id,
      staffId: session.staffId,
      tenantId: session.tenantId,
      mode: session.mode as 'TENANT_SCOPED' | 'AS_MEMBER',
      scope: session.scope as 'READ_ONLY' | 'FULL',
      targetUserId: session.targetUserId,
      targetMemberId: session.targetMemberId,
      reason: session.reason,
      expiresAt: session.expiresAt,
    };

    req.tenant = {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      plan: tenant.plan,
      databaseMode: (tenant as any).databaseMode ?? 'shared',
    };

    // If session is READ_ONLY, enforce that mutating HTTP methods are immediately blocked
    if (session.scope === 'READ_ONLY' && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      return next(AppError.forbidden('READ_ONLY support session cannot perform mutating operations'));
    }

    // Resolve effective permissions based on mode & scope
    if (session.mode === 'AS_MEMBER' && session.targetUserId) {
      const resolved = await resolveUserPermissions(tenant.id, session.targetUserId);
      const isOwner = resolved.roles.some((r) => r.toUpperCase() === SYSTEM_ROLES.OWNER);
      let perms = isOwner ? ['*'] : resolved.permissions;

      if (session.scope === 'READ_ONLY') {
        if (isOwner) {
          perms = [
            'tenants:read',
            'members:read',
            'roles:read',
            'files:read',
            'email_templates:read',
            'branding:read',
            'audit:read',
            'billing:read',
          ];
        } else {
          perms = perms.filter(
            (p) => p.endsWith(':read') || p.endsWith(':list') || p.endsWith(':view'),
          );
        }
      }

      req.permissions = perms;
      req.membership = {
        id: session.targetMemberId ?? '',
        status: 'ACTIVE',
        roles: resolved.roles,
      };
      req.user = { id: session.targetUserId, status: 'ACTIVE' };
    } else {
      // TENANT_SCOPED mode
      if (session.scope === 'READ_ONLY') {
        req.permissions = [
          'tenants:read',
          'members:read',
          'roles:read',
          'files:read',
          'email_templates:read',
          'branding:read',
          'audit:read',
          'billing:read',
        ];
      } else {
        req.permissions = [...SUPPORT_TENANT_PERMISSIONS];
      }

      req.membership = {
        id: '',
        status: 'ACTIVE',
        roles: ['SUPPORT_STAFF'],
      };
    }

    return next();
  } catch {
    // If not a valid support token, continue to try standard user access token
  }

  // 3. Fallback to standard USER access token
  try {
    const payload = verifyAccessToken(token);
    if (payload?.typ !== 'USER') {
      return next(AppError.unauthorized('Invalid access token type'));
    }
    req.user = { id: payload.sub as string };
    return next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(AppError.unauthorized('Invalid or expired authentication token'));
  }
}

/**
 * Guard that blocks specific security-sensitive actions while in a support session.
 */
export function blockInSupportSession(actionName = 'This action'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.isSupportSession) {
      return next(
        AppError.forbidden(
          `${actionName} cannot be performed while inside a support session.`,
        ),
      );
    }
    next();
  };
}

/**
 * Middleware that automatically logs any mutating actions (POST, PUT, PATCH, DELETE)
 * performed during a support session to both customer AuditLog and PlatformAuditLog.
 */
export function auditSupportActions(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', async () => {
    if (req.isSupportSession && req.method !== 'GET' && req.supportSession) {
      try {
        const action = `SUPPORT.${req.method}.${req.baseUrl || ''}${req.path || ''}`;

        await logSecurityEvent({
          tenantId: req.supportSession.tenantId,
          userId: req.user?.id,
          actorType: 'PLATFORM_STAFF',
          actorStaffId: req.supportSession.staffId,
          supportSessionId: req.supportSession.id,
          action,
          entityType: 'SupportAction',
          metadata: {
            method: req.method,
            route: `${req.baseUrl || ''}${req.path || ''}`,
            status: res.statusCode,
            mode: req.supportSession.mode,
            scope: req.supportSession.scope,
            reason: req.supportSession.reason,
          },
        });

        await platformRepo.logPlatformAction({
          actorStaffId: req.supportSession.staffId,
          action: 'tenant_support.action',
          targetType: 'tenant',
          targetId: req.supportSession.tenantId,
          tenantId: req.supportSession.tenantId,
          metadata: {
            sessionId: req.supportSession.id,
            method: req.method,
            route: `${req.baseUrl || ''}${req.path || ''}`,
            status: res.statusCode,
          },
        });
      } catch (err) {
        console.error('Failed to log support action audit trail:', err);
      }
    }
  });

  next();
}
