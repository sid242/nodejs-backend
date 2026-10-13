import { Router } from 'express';
import { requireAuth } from '@/middleware/auth.js';
import { requireTenant } from '@/middleware/tenant.js';
import { requirePermission } from '@/middleware/rbac.js';
import { validate } from '@/middleware/validate.js';
import * as dto from './tenants.dto.js';
import * as controller from './tenants.controller.js';

const router: Router = Router();

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

export default router;
