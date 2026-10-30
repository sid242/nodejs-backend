import { Router } from 'express';

import { optionalAuth, requireAuth } from '@/middleware/auth';
import { authLimiter } from '@/middleware/rate-limit';
import { requirePermission } from '@/middleware/rbac';
import { blockInSupportSession, requireSupportOrUser } from '@/middleware/support';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';
import * as billingController from '@/modules/billing/billing.controller';
import * as billingDto from '@/modules/billing/billing.dto';
import * as invitationsController from '@/modules/invitations/invitations.controller';
import * as invitationsDto from '@/modules/invitations/invitations.dto';
import { invitationsRouter } from '@/modules/invitations/invitations.routes';

import * as controller from './tenants.controller';
import * as dto from './tenants.dto';

const router: Router = Router();

// Public resolution endpoint (supports ?slug=... or ?domain=... or Host header)
router.get(
  '/public/resolve',
  validate({ query: dto.resolvePublicTenantDto }),
  controller.resolvePublicTenant,
);

// Public invitation endpoints
router.get(
  '/invitations/preview',
  optionalAuth,
  validate({ query: invitationsDto.previewInvitationQueryDto }),
  invitationsController.previewInvitation,
);

router.post(
  '/invitations/accept',
  optionalAuth,
  authLimiter,
  validate({ body: invitationsDto.acceptInvitationDto }),
  invitationsController.acceptInvitation,
);

// Global tenant endpoints for logged-in user
router.post('/', requireAuth, validate({ body: dto.createTenantDto }), controller.createTenant);

router.get('/', requireAuth, controller.getMyTenants);

// Tenant context & user entitlement endpoints
router.get('/:tenantId/context', requireSupportOrUser, requireTenant, controller.getTenantContext);
router.get('/:tenantId/me', requireSupportOrUser, requireTenant, controller.getTenantMe);

router.get(
  '/:tenantId/support-access',
  requireSupportOrUser,
  requireTenant,
  requirePermission('audit:read'),
  controller.getSupportAccess,
);

// Mount tenant-scoped invitation subrouter
router.use('/:tenantId/invitations', invitationsRouter);

// Tenant billing endpoints
router.get(
  '/:tenantId/billing',
  requireSupportOrUser,
  requireTenant,
  requirePermission('billing:read'),
  billingController.getTenantBillingOverview,
);

router.post(
  '/:tenantId/billing/change-request',
  requireSupportOrUser,
  requireTenant,
  requirePermission('billing:read'),
  validate({ body: billingDto.subscriptionChangeRequestDto }),
  billingController.requestSubscriptionChange,
);

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

router.patch(
  '/:tenantId/members/:memberId/status',
  requireAuth,
  requireTenant,
  requirePermission('members:update'),
  validate({ body: dto.updateMemberStatusDto }),
  controller.updateMemberStatus,
);

router.post(
  '/:tenantId/members/bulk',
  requireAuth,
  requireTenant,
  requirePermission('members:invite'),
  validate({ body: dto.bulkInviteMembersDto }),
  controller.bulkInviteMembers,
);

router.post(
  '/:tenantId/members/:memberId/transfer-ownership',
  requireAuth,
  requireTenant,
  blockInSupportSession('Ownership transfer'),
  requirePermission('roles:assign'),
  validate({ body: dto.transferOwnershipDto }),
  controller.transferOwnership,
);

router.get(
  '/:tenantId/audit-logs',
  requireAuth,
  requireTenant,
  requirePermission('audit:read'),
  controller.getTenantAuditTrail,
);

router.post(
  '/:tenantId/audit-logs/search',
  requireAuth,
  requireTenant,
  requirePermission('audit:read'),
  validate({ body: dto.searchAuditLogsDto }),
  controller.searchTenantAuditTrail,
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
  blockInSupportSession('SMTP configuration'),
  requirePermission('tenants:update'),
  validate({ body: dto.upsertTenantEmailConfigDto }),
  controller.upsertTenantEmailConfig,
);

router.post(
  '/:tenantId/settings/email/test',
  requireAuth,
  requireTenant,
  blockInSupportSession('SMTP configuration test'),
  requirePermission('tenants:update'),
  validate({ body: dto.testTenantEmailConfigDto }),
  controller.testTenantEmailConfig,
);

router.delete(
  '/:tenantId/settings/email',
  requireAuth,
  requireTenant,
  blockInSupportSession('SMTP configuration'),
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

router.post(
  '/:tenantId/branding/domain/verify',
  requireAuth,
  requireTenant,
  requirePermission('tenants:update'),
  validate({ body: dto.verifyCustomDomainDto }),
  controller.verifyCustomDomain,
);

// Tenant URL Settings & Custom Domain Management
router.get(
  '/:tenantId/url-settings',
  requireAuth,
  requireTenant,
  requirePermission('tenants:read'),
  controller.getTenantUrlSettings,
);

router.put(
  '/:tenantId/url-settings',
  requireAuth,
  requireTenant,
  requirePermission('tenants:update'),
  validate({ body: dto.updateTenantUrlSettingsDto }),
  controller.updateTenantUrlSettings,
);

router.delete(
  '/:tenantId/url-settings/custom-domain',
  requireAuth,
  requireTenant,
  requirePermission('tenants:update'),
  controller.deleteTenantCustomDomain,
);

export default router;
