import type { NextFunction, Request, Response } from 'express';

import { AppError } from '@/lib/errors.js';
import * as platformRepo from '@/modules/platform/platform.repository.js';
import { resolveUserPermissions, SYSTEM_ROLES } from '@/modules/rbac/rbac.service.js';
import * as tenantsRepo from '@/modules/tenants/tenants.repository.js';
import * as usersRepo from '@/modules/users/users.repository.js';

export async function resolveTenantContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user && !req.staff) {
    return next();
  }

  // 1. Identify tenant from header, path params, or query
  const rawHeader = req.headers['x-tenant-id'];
  const tenantIdentifier =
    (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader) ||
    (typeof req.params.tenantId === 'string' ? req.params.tenantId : undefined) ||
    (typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined);

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
    const supportSessionHeader = req.headers['x-support-session-id'];
    const supportSessionId = Array.isArray(supportSessionHeader)
      ? supportSessionHeader[0]
      : supportSessionHeader;

    let activeSupportSession = null;
    if (supportSessionId) {
      const session = await platformRepo.findSupportSessionById(supportSessionId);
      if (
        session &&
        session.status === 'ACTIVE' &&
        session.tenantId === tenant.id &&
        new Date(session.expiresAt) > new Date()
      ) {
        activeSupportSession = session;
        req.supportSession = {
          sessionId: session.id,
          staffId: session.staffId,
          tenantId: session.tenantId,
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
              role: targetUser.role,
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
  if (!req.user && !req.staff) {
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
