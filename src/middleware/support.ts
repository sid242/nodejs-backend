import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ACCESS_TOKEN_COOKIE, AUTH_HEADERS } from '@/constants/index';
import { runWithTenantDb } from '@/db/tenancy/context';
import { getTenantDb } from '@/db/tenancy/tenant-db';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import { verifyAccessToken, verifySupportToken } from '@/modules/auth/tokens';
import * as platformRepo from '@/modules/platform/platform.repository';
import { resolveUserPermissions, SYSTEM_ROLES } from '@/modules/rbac/rbac.service';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

export const SUPPORT_SCOPE_PRESETS = {
  READ_ONLY: [
    'tenants:read',
    'members:read',
    'roles:read',
    'files:read',
    'email-templates:read',
    'audit:read',
    'billing:read',
    'groups:read',
    'addresses:read',
  ],
  ASSIST: [
    'tenants:read',
    'tenants:update',
    'members:read',
    'roles:read',
    'files:read',
    'files:write',
    'email-templates:read',
    'email-templates:write',
    'audit:read',
    'billing:read',
    'groups:read',
    'addresses:read',
  ],
  FULL_ADMIN: [
    'tenants:read',
    'tenants:update',
    'members:read',
    'roles:read',
    'files:read',
    'files:write',
    'files:delete',
    'email-templates:read',
    'email-templates:write',
    'email-templates:delete',
    'audit:read',
    'billing:read',
    'groups:read',
    'addresses:read',
    'addresses:write',
    'addresses:delete',
  ],
  FULL: [
    'tenants:read',
    'tenants:update',
    'members:read',
    'roles:read',
    'files:read',
    'files:write',
    'files:delete',
    'email-templates:read',
    'email-templates:write',
    'email-templates:delete',
    'audit:read',
    'billing:read',
    'groups:read',
    'addresses:read',
    'addresses:write',
    'addresses:delete',
  ],
} as const;

export const SUPPORT_TENANT_PERMISSIONS = SUPPORT_SCOPE_PRESETS.FULL_ADMIN;

/**
 * Enforces strict boundaries on support tokens:
 * Prohibits accessing authentication credentials/2FA, billing writes, SSO/SCIM,
 * member/role mutations, and database operations.
 */
export function isSupportDeniedRoute(req: Request): boolean {
  const path = (req.originalUrl || req.baseUrl + req.path || '').toLowerCase();
  const method = req.method.toUpperCase();

  // 1. Auth credential & session operations
  if (
    path.includes('/auth/password') ||
    path.includes('/auth/change-password') ||
    path.includes('/auth/reset-password') ||
    path.includes('/auth/2fa') ||
    path.includes('/auth/two-factor')
  ) {
    return true;
  }

  // 2. Billing writes (invoices, subscriptions, plans)
  if (
    (path.includes('/billing') || path.includes('/invoices') || path.includes('/subscriptions')) &&
    !['GET', 'HEAD', 'OPTIONS'].includes(method)
  ) {
    return true;
  }

  // 3. SSO and SCIM tokens & configuration
  if (path.includes('/sso') || path.includes('/scim')) {
    return true;
  }

  // 4. Member / Role mutations
  if (
    (path.includes('/members') || path.includes('/roles')) &&
    !['GET', 'HEAD', 'OPTIONS'].includes(method)
  ) {
    return true;
  }

  // 5. Database operations (switchover, migrations, backups)
  if (
    path.includes('/db-ops') ||
    path.includes('/database') ||
    path.includes('/operations') ||
    path.includes('/migrate') ||
    path.includes('/db/') ||
    path.endsWith('/db')
  ) {
    return true;
  }

  return false;
}

export async function requireSupportOrUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  let token: string | undefined;

  const header = req.headers.authorization;
  if (header?.startsWith(AUTH_HEADERS.PREFIX)) {
    token = header.slice(AUTH_HEADERS.PREFIX.length).trim();
  } else if (req.cookies?.[ACCESS_TOKEN_COOKIE]) {
    token = req.cookies[ACCESS_TOKEN_COOKIE];
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
      return next(
        AppError.forbidden(`Support session is currently ${session.status.toLowerCase()}`),
      );
    }

    if (new Date(session.expiresAt) <= new Date()) {
      await platformRepo.terminateSupportSession(session.id, { status: 'EXPIRED' });
      return next(AppError.unauthorized('Support session has expired'));
    }

    if (
      session.staffId !== supportPayload.staffId ||
      session.tenantId !== supportPayload.tenantId
    ) {
      return next(AppError.unauthorized('Support session claims mismatch'));
    }

    // Resolve tenant
    const tenant = await tenantsRepo.findTenantById(session.tenantId);
    if (!tenant || tenant.deletedAt) {
      return next(AppError.notFound('Tenant workspace not found'));
    }

    if (tenant.status !== 'ACTIVE' && tenant.status !== 'TRIALING') {
      return next(
        AppError.forbidden(`Tenant workspace is currently ${tenant.status.toLowerCase()}`),
      );
    }

    req.isSupportSession = true;
    req.supportSession = {
      id: session.id,
      sessionId: session.id,
      staffId: session.staffId,
      tenantId: session.tenantId,
      mode: session.mode as 'TENANT_SCOPED' | 'AS_MEMBER',
      scope: session.scope as 'READ_ONLY' | 'ASSIST' | 'FULL' | 'FULL_ADMIN',
      targetUserId: session.targetUserId,
      targetMemberId: session.targetMemberId,
      reason: session.reason,
      expiresAt: session.expiresAt,
    };

    // Strict deny-list check for all support sessions
    if (isSupportDeniedRoute(req)) {
      return next(
        AppError.forbidden(
          'Support tokens are strictly prohibited from accessing authentication credentials, billing mutations, SSO/SCIM, member/role mutations, and database operations.',
        ),
      );
    }

    // File deletion guard: only FULL_ADMIN / FULL may delete files
    if (
      req.method === 'DELETE' &&
      (req.originalUrl || req.path).toLowerCase().includes('/files') &&
      session.scope !== 'FULL_ADMIN' &&
      session.scope !== 'FULL'
    ) {
      return next(
        AppError.forbidden('File deletion is restricted to FULL_ADMIN support sessions.'),
      );
    }

    req.tenant = {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      plan: tenant.plan,
      databaseMode: (tenant as any).databaseMode ?? 'shared',
    };

    req.db = await getTenantDb({
      id: tenant.id,
      databaseMode: (tenant as any).databaseMode ?? 'shared',
      databaseKey: (tenant as any).databaseKey,
      databaseSecretRef: (tenant as any).databaseSecretRef,
      metadata: (tenant as any).metadata,
    });

    // If session is READ_ONLY, enforce that mutating HTTP methods are immediately blocked
    if (
      session.scope === 'READ_ONLY' &&
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      req.method !== 'OPTIONS'
    ) {
      return next(
        AppError.forbidden('READ_ONLY support session cannot perform mutating operations'),
      );
    }

    // If session is ASSIST, mutations are strictly restricted to branding, email templates, and uploading files
    if (session.scope === 'ASSIST') {
      const isMutation = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
      const path = (req.originalUrl || req.path).toLowerCase();
      const isAssistRoute =
        path.includes('/branding') ||
        path.includes('/email-templates') ||
        (path.includes('/files') && req.method === 'POST');

      if (isMutation && !isAssistRoute) {
        return next(
          AppError.forbidden(
            'ASSIST support session scope only allows modifying branding, email templates, and uploading files.',
          ),
        );
      }
    }

    // Resolve effective permissions based on preset mapped to session scope
    const scopeKey = (session.scope as keyof typeof SUPPORT_SCOPE_PRESETS) || 'READ_ONLY';
    const allowedPerms: readonly string[] =
      SUPPORT_SCOPE_PRESETS[scopeKey] ?? SUPPORT_SCOPE_PRESETS.READ_ONLY;

    if (session.mode === 'AS_MEMBER' && session.targetUserId) {
      const resolved = await resolveUserPermissions(tenant.id, session.targetUserId);
      const isOwner = resolved.roles.some((r) => r.toUpperCase() === SYSTEM_ROLES.OWNER);
      const targetPerms = isOwner ? [...allowedPerms] : resolved.permissions;

      // Intersect target permissions with scope preset
      req.permissions = targetPerms.filter((p) => allowedPerms.includes(p));
      req.membership = {
        id: session.targetMemberId ?? '',
        status: 'ACTIVE',
        roles: resolved.roles,
      };
      req.user = { id: session.targetUserId, status: 'ACTIVE' };
    } else {
      // TENANT_SCOPED mode
      req.permissions = [...allowedPerms];
      req.membership = {
        id: '',
        status: 'ACTIVE',
        roles: ['SUPPORT_STAFF'],
      };
    }

    return runWithTenantDb(
      {
        tenantId: tenant.id,
        db: req.db,
        databaseMode: (tenant as any).databaseMode ?? 'shared',
      },
      () => next(),
    );
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
        AppError.forbidden(`${actionName} cannot be performed while inside a support session.`),
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
          actorUserId: null,
          effectiveUserId: req.supportSession.targetUserId ?? req.user?.id ?? null,
          actorType: 'PLATFORM_STAFF',
          actorStaffId: req.supportSession.staffId,
          supportSessionId: req.supportSession.id,
          source: 'IMPERSONATION',
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
