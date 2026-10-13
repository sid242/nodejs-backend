import { Router } from 'express';
import { requireAuth, requireRole } from '@/middleware/auth.js';
import { requireTenant } from '@/middleware/tenant.js';
import { requirePermission } from '@/middleware/rbac.js';
import { validate } from '@/middleware/validate.js';
import * as dto from './rbac.dto.js';
import * as controller from './rbac.controller.js';

const router: Router = Router();

// ==========================================
// Modules Catalog & Management (Platform-Wide)
// ==========================================
router.get('/modules', requireAuth, controller.listModules);

router.get('/modules/:moduleId', requireAuth, controller.getModule);

router.post(
  '/modules',
  requireAuth,
  requireRole('ADMIN'),
  validate({ body: dto.createModuleDto }),
  controller.createModule,
);

router.patch(
  '/modules/:moduleId',
  requireAuth,
  requireRole('ADMIN'),
  validate({ body: dto.updateModuleDto }),
  controller.updateModule,
);

router.delete('/modules/:moduleId', requireAuth, requireRole('ADMIN'), controller.deleteModule);

// ==========================================
// Permissions Catalog & Management (Platform-Wide)
// ==========================================
router.get('/permissions', requireAuth, controller.listPermissions);

router.get('/permissions/:permissionId', requireAuth, controller.getPermission);

router.post(
  '/permissions',
  requireAuth,
  requireRole('ADMIN'),
  validate({ body: dto.createPermissionDto }),
  controller.createPermission,
);

router.post(
  '/modules/:moduleId/permissions',
  requireAuth,
  requireRole('ADMIN'),
  validate({ body: dto.createPermissionDto }),
  controller.createPermission,
);

router.patch(
  '/permissions/:permissionId',
  requireAuth,
  requireRole('ADMIN'),
  validate({ body: dto.updatePermissionDto }),
  controller.updatePermission,
);

router.delete(
  '/permissions/:permissionId',
  requireAuth,
  requireRole('ADMIN'),
  controller.deletePermission,
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
