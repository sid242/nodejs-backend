import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePermission } from '@/middleware/rbac';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';

import * as controller from './rbac.controller';
import * as dto from './rbac.dto';

const router: Router = Router();

// ==========================================
// Modules & Permissions Catalog (Read-Only for Tenant Role Management)
// ==========================================
router.get(
  '/modules',
  requireAuth,
  requireTenant,
  requirePermission('roles:read'),
  controller.listModules,
);

router.get(
  '/modules/:moduleId',
  requireAuth,
  requireTenant,
  requirePermission('roles:read'),
  controller.getModule,
);

router.get(
  '/permissions',
  requireAuth,
  requireTenant,
  requirePermission('roles:read'),
  controller.listPermissions,
);

router.get(
  '/permissions/:permissionId',
  requireAuth,
  requireTenant,
  requirePermission('roles:read'),
  controller.getPermission,
);

// ==========================================
// Tenant-Scoped Dynamic Roles
// ==========================================
router.get(
  '/tenants/:tenantId/roles',
  requireAuth,
  requireTenant,
  requirePermission('roles:read'),
  controller.listTenantRoles,
);

router.post(
  '/tenants/:tenantId/roles',
  requireAuth,
  requireTenant,
  requirePermission('roles:create'),
  validate({ body: dto.createRoleDto }),
  controller.createTenantRole,
);

router.patch(
  '/tenants/:tenantId/roles/:roleId',
  requireAuth,
  requireTenant,
  requirePermission('roles:update'),
  validate({ body: dto.updateRoleDto }),
  controller.updateTenantRole,
);

router.delete(
  '/tenants/:tenantId/roles/:roleId',
  requireAuth,
  requireTenant,
  requirePermission('roles:delete'),
  controller.deleteTenantRole,
);

// Backward-compatible alias
router.delete(
  '/:tenantId/roles/:roleId',
  requireAuth,
  requireTenant,
  requirePermission('roles:delete'),
  controller.deleteTenantRole,
);

// ==========================================
// Tenant-Scoped Module Entitlements / Feature Gating
// ==========================================
router.get('/tenants/:tenantId/modules', requireAuth, requireTenant, controller.listTenantModules);

router.patch(
  '/tenants/:tenantId/modules/:moduleId',
  requireAuth,
  requireTenant,
  requirePermission('tenants:update'),
  validate({ body: dto.toggleModuleDto }),
  controller.toggleTenantModule,
);

export default router;
