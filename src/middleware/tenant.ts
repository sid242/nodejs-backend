import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { env } from '@/config/env';
import { AppError } from '@/lib/errors';
import * as platformRepo from '@/modules/platform/platform.repository';
import { resolveUserPermissions, SYSTEM_ROLES } from '@/modules/rbac/rbac.service';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';
import * as usersRepo from '@/modules/users/users.repository';

export function hasValidBffSecret(req: Request): boolean {
  const secretHeader = req.headers?.['x-bff-secret'];
  const raw = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
  if (!raw || typeof raw !== 'string') return false;
  const expected = env.BFF_SHARED_SECRET;
  if (!expected || raw.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(raw), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function resolveTenantContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.isSupportSession && req.tenant) {
    return next();
  }

  if (!req.user && !req.staff) {
    return next();
  }

  // 1. Identify tenant from accepted sources in strict order:
  // (a) x-tenant-id ONLY when carrying valid x-bff-secret header
  // (b) route param :tenantId
  // (c) token claim / single-tenant auto-fallback
  let tenantIdentifier: string | undefined;

  const rawHeader = req.headers?.['x-tenant-id'];
  const headerTenantId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  if (headerTenantId && hasValidBffSecret(req)) {
    tenantIdentifier = headerTenantId;
  }

  if (!tenantIdentifier && typeof req.params?.tenantId === 'string') {
    tenantIdentifier = req.params.tenantId;
  }

  if (!tenantIdentifier && (req.user as any)?.tenantId) {
    tenantIdentifier = (req.user as any).tenantId;
  }

  // If omitted and user is authenticated, auto-resolve if user has exactly one active tenant
  if (!tenantIdentifier && req.user?.id) {
    try {
      const userTenants = await tenantsRepo.findUserTenants(req.user.id);
      if (userTenants?.length === 1 && userTenants?.[0]?.id) {
        tenantIdentifier = userTenants[0].id;
      }
    } catch {
      /* ignore lookup failure */
    }
  }

  if (!tenantIdentifier) {
    return next();
  }

  try {
    // 2. Fetch tenant by UUID or by slug
    let tenant = await tenantsRepo.findTenantById(tenantIdentifier);
    if (!tenant) {
      tenant = await tenantsRepo.findTenantBySlug(tenantIdentifier);
    }

    if (!tenant || tenant.deletedAt) {
      return next(AppError.notFound('Tenant organization not found'));
    }

    if (tenant.status !== 'ACTIVE' && tenant.status !== 'TRIALING') {
      return next(AppError.forbidden(`Tenant is currently ${tenant.status.toLowerCase()}`));
    }

    // 3. Check for an active, audited support delegation session
    // Strict caller binding: only honor support session if caller is authenticated as platform staff
    // and the support session belongs to that specific staff member.
    const supportSessionHeader = req.headers['x-support-session-id'];
    const supportSessionId = Array.isArray(supportSessionHeader)
      ? supportSessionHeader[0]
      : supportSessionHeader;

    let activeSupportSession = null;
    if (supportSessionId && req.staff?.id) {
      const session = await platformRepo.findSupportSessionById(supportSessionId);
      if (
        session &&
        session.status === 'ACTIVE' &&
        session.tenantId === tenant.id &&
        session.staffId === req.staff.id &&
        new Date(session.expiresAt) > new Date()
      ) {
        activeSupportSession = session;
        req.supportSession = {
          id: session.id,
          sessionId: session.id,
          staffId: session.staffId,
          tenantId: session.tenantId,
          mode: session.mode as any,
          scope: session.scope as any,
          targetUserId: session.targetUserId,
          targetMemberId: session.targetMemberId,
          reason: session.reason,
          expiresAt: session.expiresAt,
        };
        req.isImpersonated = true;

        if (session.targetUserId) {
          const targetUser = await usersRepo.findById(session.targetUserId);
          if (targetUser) {
            req.impersonator = {
              userId: req.user?.id ?? req.staff?.id ?? session.staffId,
              role: 'SUPPORT_STAFF',
              reason: session.reason,
              sessionId: session.id,
            };
            req.user = {
              id: targetUser.id,
              status: targetUser.status,
            };
          }
        }
      }
    }

    // 4. Verify user membership in tenant (Strict isolation: no blanket platform staff bypass)
    let member = null;
    if (req.user?.id) {
      member = await tenantsRepo.findTenantMember(tenant.id, req.user.id);
    }

    if (!member && !activeSupportSession) {
      return next(
        AppError.forbidden(
          'You are not a member of this tenant. Support staff require an active, audited support session.',
        ),
      );
    }

    if (member && member.status !== 'ACTIVE') {
      return next(
        AppError.forbidden(`Your membership in this tenant is ${member.status.toLowerCase()}`),
      );
    }

    // 5. Resolve permissions
    let effectivePermissions: string[] = [];
    let roles: string[] = [];

    if (activeSupportSession) {
      // Under audited support delegation, staff access is granted with specific support scope
      roles = ['SUPPORT_STAFF'];
      effectivePermissions = ['*']; // Full troubleshooting scope bounded by support session
    } else if (member && req.user?.id) {
      const resolved = await resolveUserPermissions(tenant.id, req.user.id);
      roles = resolved.roles;
      effectivePermissions = roles.includes(SYSTEM_ROLES.OWNER) ? ['*'] : resolved.permissions;
    }

    req.tenant = {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      plan: tenant.plan,
      databaseMode: (tenant as any).databaseMode ?? 'shared',
    };

    if (member) {
      req.membership = {
        id: member.id,
        status: member.status,
        roles,
      };
    }

    req.permissions = effectivePermissions;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.isSupportSession && req.tenant) {
    return next();
  }

  if (!req.user && !req.staff && !req.isSupportSession) {
    return next(AppError.unauthorized('Authentication required to access tenant resources'));
  }

  await resolveTenantContext(req, res, (err) => {
    if (err) return next(err);
    if (!req.tenant) {
      return next(
        AppError.badRequest(
          'Tenant identifier missing (provide x-tenant-id header or tenantId parameter)',
        ),
      );
    }
    next();
  });
}
