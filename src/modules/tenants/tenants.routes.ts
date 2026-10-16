import { Router } from 'express';
import { requireAuth } from '@/middleware/auth.js';
import { requireTenant } from '@/middleware/tenant.js';
import { requirePermission } from '@/middleware/rbac.js';
import { validate } from '@/middleware/validate.js';
import * as dto from './tenants.dto.js';
import * as controller from './tenants.controller.js';

const router: Router = Router();

// Public resolution endpoint (supports ?slug=... or ?domain=... or Host header)
router.get(
  '/public/resolve',
  validate({ query: dto.resolvePublicTenantDto }),
  controller.resolvePublicTenant,
);

// Global tenant endpoints for logged-in user
router.post('/', requireAuth, validate({ body: dto.createTenantDto }), controller.createTenant);

router.get('/', requireAuth, controller.getMyTenants);

// Scoped tenant endpoints (require tenant membership & dynamic RBAC permission)
router.get(
  '/:tenantId',
  requireAuth,
  requireTenant,
  requirePermission('tenants:read'),
  controller.getTenant,
);

router.patch(
  '/:tenantId',
  requireAuth,
  requireTenant,
  requirePermission('tenants:update'),
  validate({ body: dto.updateTenantDto }),
  controller.updateTenant,
);

router.get(
  '/:tenantId/members',
  requireAuth,
  requireTenant,
  requirePermission('members:read'),
  controller.listMembers,
);

router.post(
  '/:tenantId/members',
  requireAuth,
  requireTenant,
  requirePermission('members:invite'),
  validate({ body: dto.addMemberDto }),
  controller.addMember,
);

router.delete(
  '/:tenantId/members/:memberId',
  requireAuth,
  requireTenant,
  requirePermission('members:delete'),
  controller.removeMember,
);

router.patch(
  '/:tenantId/members/:memberId/role',
  requireAuth,
  requireTenant,
  requirePermission('roles:assign'),
  validate({ body: dto.updateMemberRoleDto }),
  controller.updateMemberRole,
);

router.get(
  '/:tenantId/audit-logs',
  requireAuth,
  requireTenant,
  requirePermission('audit:read'),
  controller.getTenantAuditTrail,
);

// Tenant Custom SMTP Settings
router.get(
  '/:tenantId/settings/email',
  requireAuth,
  requireTenant,
  requirePermission('tenants:read'),
  controller.getTenantEmailConfig,
);

router.put(
  '/:tenantId/settings/email',
  requireAuth,
  requireTenant,
  requirePermission('tenants:update'),
  validate({ body: dto.upsertTenantEmailConfigDto }),
  controller.upsertTenantEmailConfig,
);

router.post(
  '/:tenantId/settings/email/test',
  requireAuth,
  requireTenant,
  requirePermission('tenants:update'),
  validate({ body: dto.testTenantEmailConfigDto }),
  controller.testTenantEmailConfig,
);

router.delete(
  '/:tenantId/settings/email',
  requireAuth,
  requireTenant,
  requirePermission('tenants:update'),
  controller.deleteTenantEmailConfig,
);

// Tenant White-Label & Branding Management
router.get(
  '/:tenantId/branding',
  requireAuth,
  requireTenant,
  requirePermission('tenants:read'),
  controller.getTenantBranding,
);

router.put(
  '/:tenantId/branding',
  requireAuth,
  requireTenant,
  requirePermission('tenants:update'),
  validate({ body: dto.updateTenantBrandingDto }),
  controller.updateTenantBranding,
);

router.post(
  '/:tenantId/branding/logo-presigned',
  requireAuth,
  requireTenant,
  requirePermission('tenants:update'),
  validate({ body: dto.requestBrandingUploadUrlDto }),
  controller.requestBrandingUploadUrl,
);

export default router;
