import type { NextFunction, Request, Response } from 'express';

import { AppError } from '@/lib/errors.js';
import { resolveUserPermissions, SYSTEM_ROLES } from '@/modules/rbac/rbac.service.js';
import * as tenantsRepo from '@/modules/tenants/tenants.repository.js';

export async function requireTenant(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    return next(AppError.unauthorized('Authentication required to access tenant resources'));
  }

  // 1. Identify tenant from header, path params, or query
  const rawHeader = req.headers['x-tenant-id'];
  const tenantIdentifier =
    (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader) ||
    (typeof req.params.tenantId === 'string' ? req.params.tenantId : undefined) ||
    (typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined);

  if (!tenantIdentifier) {
    return next(
      AppError.badRequest(
        'Tenant identifier missing (provide x-tenant-id header or tenantId parameter)',
      ),
    );
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

    // 3. Verify user membership in tenant (unless global system ADMIN)
    const isSystemAdmin = req.user.role === 'ADMIN';
    const member = await tenantsRepo.findTenantMember(tenant.id, req.user.id);

    if (!member && !isSystemAdmin) {
      return next(AppError.forbidden('You are not a member of this tenant'));
    }

    if (member && member.status !== 'ACTIVE') {
      return next(
        AppError.forbidden(`Your membership in this tenant is ${member.status.toLowerCase()}`),
      );
    }

    // 4. Resolve dynamic RBAC permissions (cached)
    const { roles, permissions } = await resolveUserPermissions(tenant.id, req.user.id);

    // If user is system admin, grant all permissions
    const effectivePermissions =
      isSystemAdmin || roles.includes(SYSTEM_ROLES.OWNER) ? ['*'] : permissions;

    req.tenant = {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      plan: tenant.plan,
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
