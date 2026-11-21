import { Router, type Request, type Response } from 'express';

import { optionalAuth, requireAuth } from '@/middleware/auth';
import { authLimiter, resolveLimiter } from '@/middleware/rate-limit';
import { requirePermission } from '@/middleware/rbac';
import { blockInSupportSession, requireSupportOrUser } from '@/middleware/support';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';
import { tenantAccessRouter, tenantAuditRouter } from '@/modules/audit/audit.routes';
import * as billingController from '@/modules/billing/billing.controller';
import * as billingDto from '@/modules/billing/billing.dto';
import * as invitationsController from '@/modules/invitations/invitations.controller';
import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';
import * as invitationsDto from '@/modules/invitations/invitations.dto';
import { invitationsRouter } from '@/modules/invitations/invitations.routes';
import * as featureFlagsService from '@/modules/feature-flags/feature-flags.service';
import developersRouter from '@/modules/developers/developers.routes';
import { tenantAnalyticsRouter } from '@/modules/analytics/analytics.routes';
import { onboardingRouter } from '@/modules/onboarding/onboarding.routes';
import * as privacyController from '@/modules/privacy/privacy.controller';
import * as privacyDto from '@/modules/privacy/privacy.dto';
import { tenantScimManagementRouter, tenantSsoRouter } from '@/modules/sso/sso.routes';
import { tenantSupportRouter } from '@/modules/support/support.routes';

import * as controller from './tenants.controller';
import * as dto from './tenants.dto';

const router: Router = Router();

// Public resolution endpoint (supports ?slug=... or ?domain=... or Host header)
router.get(
  '/public/resolve',
  resolveLimiter,
  validate({ query: dto.resolvePublicTenantDto }),
  controller.resolvePublicTenant,
);

// Real-time debounced availability checks
router.get(
  '/check-slug',
  resolveLimiter,
  validate({ query: dto.checkSlugQueryDto }),
  controller.checkTenantSlugAvailability,
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
  '/:tenantId/flags',
  requireAuth,
  requireTenant,
  asyncHandler(async (req: Request, res: Response) => {
    const flags = await featureFlagsService.evaluateAll({
      tenantId: req.tenant?.id,
      userId: req.user?.id,
    });
    return AppResponse.ok(flags).send(res);
  }),
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

router.patch(
  '/:tenantId/slug',
  requireAuth,
  requireTenant,
  requirePermission('tenants:update'),
  validate({ body: dto.changeSlugDto }),
  controller.changeTenantSlug,
);

router.get(
  '/:tenantId/members',
  requireAuth,
  requireTenant,
  requirePermission('members:read'),
  validate({ query: dto.listMembersQueryDto }),
  controller.listMembers,
);

router.get(
  '/:tenantId/members/export',
  requireAuth,
  requireTenant,
  requirePermission('members:read'),
  validate({ query: dto.exportMembersQueryDto }),
  controller.exportMembers,
);

router.get(
  '/:tenantId/members/:memberId',
  requireAuth,
  requireTenant,
  requirePermission('members:read'),
  controller.getMember,
);

router.post(
  '/:tenantId/members',
  requireAuth,
  requireTenant,
  requirePermission('members:invite'),
  validate({ body: dto.addMemberDto }),
  controller.addMember,
);

router.get(
  '/:tenantId/members/check-email',
  requireAuth,
  requireTenant,
  requirePermission('members:read'),
  validate({ query: dto.checkMemberEmailQueryDto }),
  controller.checkMemberEmailAvailability,
);

router.patch(
  '/:tenantId/members/:memberId',
  requireAuth,
  requireTenant,
  requirePermission('members:update'),
  validate({ body: dto.updateMemberDto }),
  controller.updateMember,
);

router.delete(
  '/:tenantId/members/:memberId',
  requireAuth,
  requireTenant,
  requirePermission('members:delete'),
  controller.removeMember,
);

router.post(
  '/:tenantId/members/:memberId/offboard',
  requireAuth,
  requireTenant,
  requirePermission('members:delete'),
  validate({ body: dto.offboardMemberDto }),
  controller.offboardMember,
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

// Modular Enterprise Audit Trail & Retention Subrouter
router.use('/:tenantId/audit', requireAuth, requireTenant, tenantAuditRouter);

// Effective Access & Zero-Mutation Permissions Simulator Subrouter
router.use('/:tenantId/access', requireAuth, requireTenant, tenantAccessRouter);

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

// Typed Workspace General Settings
router.get(
  '/:tenantId/settings',
  requireAuth,
  requireTenant,
  requirePermission('tenants:read'),
  controller.getTenantSettings,
);

router.put(
  '/:tenantId/settings',
  requireAuth,
  requireTenant,
  blockInSupportSession('workspace settings'),
  requirePermission('tenants:update'),
  validate({ body: dto.updateTenantSettingsDto }),
  controller.updateTenantSettings,
);

router.patch(
  '/:tenantId/settings',
  requireAuth,
  requireTenant,
  blockInSupportSession('workspace settings'),
  requirePermission('tenants:update'),
  validate({ body: dto.updateTenantSettingsDto }),
  controller.updateTenantSettings,
);

// Workspace Security Policies
router.get(
  '/:tenantId/settings/security',
  requireAuth,
  requireTenant,
  requirePermission('tenants:read'),
  controller.getTenantSecurityPolicy,
);

router.put(
  '/:tenantId/settings/security',
  requireAuth,
  requireTenant,
  blockInSupportSession('security policies'),
  requirePermission('tenants:update'),
  validate({ body: dto.updateTenantSecurityPolicyDto }),
  controller.updateTenantSecurityPolicy,
);

router.patch(
  '/:tenantId/settings/security',
  requireAuth,
  requireTenant,
  blockInSupportSession('security policies'),
  requirePermission('tenants:update'),
  validate({ body: dto.updateTenantSecurityPolicyDto }),
  controller.updateTenantSecurityPolicy,
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

// Enterprise SSO & SCIM Directory Sync Management
router.use('/:tenantId/sso', tenantSsoRouter);
router.use('/:tenantId/scim', tenantScimManagementRouter);

// Developer API Keys & Webhooks Management
router.use('/:tenantId/developers', developersRouter);
router.use('/:tenantId', developersRouter);

// Privacy, Workspace Data Export & Closure (GDPR / DPDP)
router.post(
  '/:tenantId/data-export',
  requireAuth,
  requireTenant,
  requirePermission('tenants:export'),
  privacyController.requestTenantDataExport,
);
router.get(
  '/:tenantId/data-exports',
  requireAuth,
  requireTenant,
  requirePermission('tenants:read'),
  privacyController.listTenantDataExports,
);
router.post(
  '/:tenantId/close',
  requireAuth,
  requireTenant,
  requirePermission('tenants:close'),
  validate({ body: privacyDto.requestTenantClosureDto }),
  privacyController.requestTenantClosure,
);
router.post(
  '/:tenantId/close/cancel',
  requireAuth,
  requireTenant,
  requirePermission('tenants:close'),
  privacyController.cancelTenantClosure,
);
router.get(
  '/:tenantId/close',
  requireAuth,
  requireTenant,
  requirePermission('tenants:read'),
  privacyController.getTenantClosureStatus,
);

// Analytics, Usage Metering, Activity & Reports
router.use('/:tenantId', tenantAnalyticsRouter);

// Onboarding & Activation
router.use('/:tenantId/onboarding', onboardingRouter);

// Customer Support Tickets
router.use('/:tenantId/support', tenantSupportRouter);

export default router;
