import { Router } from 'express';

import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform.js';
import { validate } from '@/middleware/validate.js';
import {
  disableTwoFactorDto,
  enableTwoFactorDto,
  verifyTwoFactorChallengeDto,
} from '@/modules/auth/auth.dto.js';

import * as controller from './platform.controller.js';
import * as dto from './platform.dto.js';
import { PLATFORM_PERMISSIONS } from './platform.permissions.js';

const router: Router = Router();

// ==========================================
// Public Platform Staff Authentication
// ==========================================
router.post('/auth/login', validate({ body: dto.loginStaffDto }), controller.login);
router.post(
  '/auth/2fa/verify',
  validate({ body: verifyTwoFactorChallengeDto }),
  controller.verifyTwoFactor,
);
router.post('/auth/logout', controller.logout);

// All subsequent platform endpoints require internal platform staff authentication
router.use(requirePlatformAuth);

router.get('/auth/me', controller.getMe);
router.post('/auth/2fa/setup', controller.setupTwoFactor);
router.post('/auth/2fa/enable', validate({ body: enableTwoFactorDto }), controller.enableTwoFactor);
router.post(
  '/auth/2fa/disable',
  validate({ body: disableTwoFactorDto }),
  controller.disableTwoFactor,
);
router.get('/auth/2fa/status', controller.getTwoFactorStatus);

// ==========================================
// 1. Platform Staff Management
// ==========================================
router.get(
  '/staff',
  requirePlatformPermission(PLATFORM_PERMISSIONS.STAFF_READ),
  validate({ query: dto.listStaffQueryDto }),
  controller.listStaff,
);

router.get(
  '/staff/:id',
  requirePlatformPermission(PLATFORM_PERMISSIONS.STAFF_READ),
  controller.getStaff,
);

router.post(
  '/staff',
  requirePlatformPermission(PLATFORM_PERMISSIONS.STAFF_CREATE),
  validate({ body: dto.createStaffDto }),
  controller.createStaff,
);

router.patch(
  '/staff/:id',
  requirePlatformPermission(PLATFORM_PERMISSIONS.STAFF_UPDATE),
  validate({ body: dto.updateStaffDto }),
  controller.updateStaff,
);

router.post(
  '/staff/:id/suspend',
  requirePlatformPermission(PLATFORM_PERMISSIONS.STAFF_DISABLE),
  validate({ body: dto.suspendStaffDto }),
  controller.suspendStaff,
);

router.post(
  '/staff/:id/activate',
  requirePlatformPermission(PLATFORM_PERMISSIONS.STAFF_UPDATE),
  controller.activateStaff,
);

router.post(
  '/staff/:id/reset-password',
  requirePlatformPermission(PLATFORM_PERMISSIONS.STAFF_UPDATE),
  validate({ body: dto.resetStaffPasswordDto }),
  controller.resetStaffPassword,
);

// ==========================================
// 2. Platform Roles & Permission Catalogue
// ==========================================
router.get(
  '/roles',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ROLES_READ),
  controller.listRoles,
);

router.get(
  '/roles/:id',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ROLES_READ),
  controller.getRole,
);

router.post(
  '/roles',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ROLES_MANAGE),
  validate({ body: dto.createPlatformRoleDto }),
  controller.createRole,
);

router.patch(
  '/roles/:id',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ROLES_MANAGE),
  validate({ body: dto.updatePlatformRoleDto }),
  controller.updateRole,
);

router.get(
  '/permissions',
  requirePlatformPermission(PLATFORM_PERMISSIONS.PERMISSIONS_READ),
  controller.listPermissions,
);

// ==========================================
// 3. Audited Customer Support Delegation
// ==========================================
router.get(
  '/support-sessions',
  requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_START),
  validate({ query: dto.listSupportSessionsQueryDto }),
  controller.listSupportSessions,
);

router.post(
  '/tenants/:id/support-sessions',
  requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_START),
  validate({ body: dto.startSupportSessionDto }),
  controller.startSupportSession,
);

router.post(
  '/support-sessions/:id/end',
  requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_END),
  validate({ body: dto.endSupportSessionDto }),
  controller.endSupportSession,
);

// ==========================================
// 4. Security & Compliance Platform Audit Logs
// ==========================================
router.get(
  '/audit-logs',
  requirePlatformPermission(PLATFORM_PERMISSIONS.AUDIT_READ),
  validate({ query: dto.queryPlatformAuditLogsDto }),
  controller.queryAuditLogs,
);

// ==========================================
// 5. Tenant Oversight & Provisioning
// ==========================================
router.get(
  '/tenants',
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_READ),
  validate({ query: dto.listPlatformTenantsQueryDto }),
  controller.listTenants,
);

router.post(
  '/tenants',
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_MANAGE),
  validate({ body: dto.provisionTenantDto }),
  controller.provisionTenant,
);

router.get(
  '/tenants/:id',
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_READ),
  controller.getTenant,
);

router.get(
  '/tenants/:id/members',
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_READ),
  controller.listTenantMembers,
);

router.patch(
  '/tenants/:id',
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_MANAGE),
  validate({ body: dto.updatePlatformTenantDto }),
  controller.updateTenant,
);

router.post(
  '/tenants/:id/suspend',
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_SUSPEND),
  validate({ body: dto.suspendTenantDto }),
  controller.suspendTenant,
);

router.post(
  '/tenants/:id/activate',
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_SUSPEND),
  validate({ body: dto.activateTenantDto }),
  controller.activateTenant,
);

router.get(
  '/tenants/:id/subscription',
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_READ),
  controller.getTenantSubscription,
);

router.patch(
  '/tenants/:id/subscription',
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ body: dto.updatePlatformTenantSubscriptionDto }),
  controller.updateTenantSubscription,
);

export default router;
