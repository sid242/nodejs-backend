import { Router } from 'express';

import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform';
import { validate } from '@/middleware/validate';
import {
  disableTwoFactorDto,
  enableTwoFactorDto,
  verifyTwoFactorChallengeDto,
} from '@/modules/auth/auth.dto';
import * as groupsDto from '@/modules/groups/groups.dto';
import * as platformGroupsController from '@/modules/groups/platform-groups.controller';
import * as policiesController from '@/modules/policies/policies.controller';
import * as policiesDto from '@/modules/policies/policies.dto';
import * as privacyController from '@/modules/privacy/privacy.controller';
import * as privacyDto from '@/modules/privacy/privacy.dto';
import * as rbacController from '@/modules/rbac/rbac.controller';
import * as rbacDto from '@/modules/rbac/rbac.dto';
import * as tenantDto from '@/modules/tenants/tenants.dto';
import * as usersController from '@/modules/users/users.controller';
import * as usersDto from '@/modules/users/users.dto';

import * as controller from './platform.controller';
import * as dto from './platform.dto';
import { PLATFORM_PERMISSIONS } from './platform.permissions';

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
router.post(
  '/staff/invite/accept',
  validate({ body: dto.acceptStaffInviteDto }),
  controller.acceptStaffInvite,
);

// All subsequent platform endpoints require internal platform staff authentication
router.use(requirePlatformAuth);

router.get('/auth/me', controller.getMe);
router.patch('/auth/me', validate({ body: dto.updatePlatformProfileDto }), controller.updateMe);
router.post(
  '/auth/me/avatar-upload-url',
  validate({ body: dto.staffAvatarUploadUrlDto }),
  controller.getStaffAvatarUploadUrl,
);
router.post(
  '/auth/change-password',
  validate({ body: dto.changePlatformPasswordDto }),
  controller.changePassword,
);
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
  '/staff/check-email',
  requirePlatformPermission(PLATFORM_PERMISSIONS.STAFF_READ),
  validate({ query: dto.checkStaffEmailQueryDto }),
  controller.checkStaffEmailAvailability,
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

router.post(
  '/staff/invite',
  requirePlatformPermission(PLATFORM_PERMISSIONS.STAFF_CREATE),
  validate({ body: dto.inviteStaffDto }),
  controller.inviteStaff,
);

router.post(
  '/staff/:id/resend-invite',
  requirePlatformPermission(PLATFORM_PERMISSIONS.STAFF_CREATE),
  controller.resendStaffInvite,
);

router.post(
  '/staff/:id/revoke-invite',
  requirePlatformPermission(PLATFORM_PERMISSIONS.STAFF_DISABLE),
  controller.revokeStaffInvite,
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
  '/support-sessions/:id/enter',
  requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_START),
  controller.enterSupportSession,
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

router.get(
  '/audit-logs/verify/:tenantId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.AUDIT_READ),
  controller.verifyPlatformTenantAuditChain,
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

router.post(
  '/tenants/:id/retry-provisioning',
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_MANAGE),
  validate({ body: dto.retryProvisioningDto }),
  controller.retryTenantProvisioning,
);

router.post(
  '/tenants/:id/close',
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_DELETE),
  validate({ body: dto.closeTenantDto }),
  controller.closeTenant,
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

router.post(
  '/tenants/:id/url-settings/override',
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_MANAGE),
  validate({ body: tenantDto.overrideTenantCustomDomainDto }),
  controller.overrideTenantUrlSettings,
);

// Legal Holds Control Plane
router.post(
  '/tenants/:tenantId/legal-hold',
  requirePlatformPermission(PLATFORM_PERMISSIONS.LEGAL_HOLD_MANAGE),
  validate({ body: privacyDto.placeLegalHoldDto }),
  privacyController.placeLegalHold,
);
router.delete(
  '/tenants/:tenantId/legal-hold',
  requirePlatformPermission(PLATFORM_PERMISSIONS.LEGAL_HOLD_MANAGE),
  validate({ body: privacyDto.releaseLegalHoldDto }),
  privacyController.releaseLegalHold,
);
router.get(
  '/tenants/:tenantId/legal-hold',
  requirePlatformPermission(PLATFORM_PERMISSIONS.LEGAL_HOLD_READ),
  privacyController.getLegalHold,
);

// ==========================================
// 5.1 Dedicated Database Lifecycle & Health
// ==========================================
router.get(
  '/database-operations',
  requirePlatformPermission(PLATFORM_PERMISSIONS.HEALTH_READ),
  validate({ query: dto.listTenantDatabasesQueryDto }),
  controller.listTenantDatabases,
);

router.post(
  '/database-operations/:id/execute',
  requirePlatformPermission([
    PLATFORM_PERMISSIONS.TENANTS_MANAGE,
    PLATFORM_PERMISSIONS.DATABASE_OPERATE,
  ]),
  validate({ body: dto.executeTenantDatabaseOperationDto }),
  controller.executeTenantDatabaseOperation,
);

router.get(
  '/database-operations/history/:opId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.HEALTH_READ),
  controller.getTenantDbOperation,
);

router.get(
  '/tenants/:id/database-operations',
  requirePlatformPermission(PLATFORM_PERMISSIONS.HEALTH_READ),
  controller.listTenantDbOperations,
);

router.post(
  '/database-operations/history/:opId/approve',
  requirePlatformPermission(PLATFORM_PERMISSIONS.DATABASE_OPERATE),
  validate({ body: dto.approveTenantDatabaseOperationDto }),
  controller.approveTenantDbOperation,
);

router.post(
  '/database-operations/history/:opId/cancel',
  requirePlatformPermission(PLATFORM_PERMISSIONS.DATABASE_OPERATE),
  controller.cancelTenantDbOperation,
);

router.post(
  '/tenants/:id/database/migrate-to-dedicated',
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_MANAGE),
  validate({ body: dto.migrateTenantDatabaseDto }),
  controller.migrateTenantDatabase,
);

router.post(
  '/tenants/:id/database/rollback-to-shared',
  requirePlatformPermission(PLATFORM_PERMISSIONS.TENANTS_MANAGE),
  controller.rollbackTenantDatabase,
);

router.get(
  '/tenants/:id/database/health',
  requirePlatformPermission(PLATFORM_PERMISSIONS.HEALTH_READ),
  controller.getTenantDatabaseHealth,
);

router.get(
  '/system/database-pools',
  requirePlatformPermission(PLATFORM_PERMISSIONS.HEALTH_READ),
  controller.getDatabasePoolStats,
);

// ==========================================
// 6. Global User Administration
// ==========================================
router.get(
  '/users',
  requirePlatformPermission(PLATFORM_PERMISSIONS.USERS_READ),
  validate({ query: usersDto.listUsersQueryDto }),
  usersController.listUsers,
);

router.get(
  '/users/:userId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.USERS_READ),
  validate({ params: usersDto.userIdParamDto }),
  usersController.getUser,
);

router.patch(
  '/users/:userId/status',
  requirePlatformPermission(PLATFORM_PERMISSIONS.USERS_SUSPEND),
  validate({ params: usersDto.userIdParamDto, body: usersDto.updateUserStatusDto }),
  usersController.updateUserStatus,
);

// ==========================================
// 7. System RBAC Catalog CRUD
// ==========================================
router.post(
  '/rbac/modules',
  requirePlatformPermission(PLATFORM_PERMISSIONS.RBAC_CATALOG_MANAGE),
  validate({ body: rbacDto.createModuleDto }),
  rbacController.createModule,
);

router.patch(
  '/rbac/modules/:moduleId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.RBAC_CATALOG_MANAGE),
  validate({ body: rbacDto.updateModuleDto }),
  rbacController.updateModule,
);

router.delete(
  '/rbac/modules/:moduleId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.RBAC_CATALOG_MANAGE),
  rbacController.deleteModule,
);

router.post(
  '/rbac/permissions',
  requirePlatformPermission(PLATFORM_PERMISSIONS.RBAC_CATALOG_MANAGE),
  validate({ body: rbacDto.createPermissionDto }),
  rbacController.createPermission,
);

router.post(
  '/rbac/modules/:moduleId/permissions',
  requirePlatformPermission(PLATFORM_PERMISSIONS.RBAC_CATALOG_MANAGE),
  validate({ body: rbacDto.createPermissionDto }),
  rbacController.createPermission,
);

router.patch(
  '/rbac/permissions/:permissionId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.RBAC_CATALOG_MANAGE),
  validate({ body: rbacDto.updatePermissionDto }),
  rbacController.updatePermission,
);

router.delete(
  '/rbac/permissions/:permissionId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.RBAC_CATALOG_MANAGE),
  rbacController.deletePermission,
);

// ==========================================
// Platform User Groups Management
// ==========================================
router.get(
  '/groups',
  requirePlatformPermission(PLATFORM_PERMISSIONS.GROUPS_READ),
  validate({ query: groupsDto.listGroupsQueryDto }),
  platformGroupsController.listPlatformGroups,
);

router.post(
  '/groups',
  requirePlatformPermission(PLATFORM_PERMISSIONS.GROUPS_CREATE),
  validate({ body: groupsDto.createGroupDto }),
  platformGroupsController.createPlatformGroup,
);

router.get(
  '/groups/:groupId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.GROUPS_READ),
  validate({ params: groupsDto.groupIdParamDto }),
  platformGroupsController.getPlatformGroup,
);

router.patch(
  '/groups/:groupId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.GROUPS_UPDATE),
  validate({ params: groupsDto.groupIdParamDto, body: groupsDto.updateGroupDto }),
  platformGroupsController.updatePlatformGroup,
);

router.delete(
  '/groups/:groupId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.GROUPS_DELETE),
  validate({ params: groupsDto.groupIdParamDto }),
  platformGroupsController.archivePlatformGroup,
);

router.get(
  '/groups/:groupId/members',
  requirePlatformPermission(PLATFORM_PERMISSIONS.GROUPS_READ),
  validate({ params: groupsDto.groupIdParamDto, query: groupsDto.listGroupMembersQueryDto }),
  platformGroupsController.listPlatformGroupMembers,
);

router.post(
  '/groups/:groupId/members',
  requirePlatformPermission(PLATFORM_PERMISSIONS.GROUPS_MANAGE_MEMBERS),
  validate({ params: groupsDto.groupIdParamDto, body: groupsDto.addPlatformGroupMembersDto }),
  platformGroupsController.addPlatformGroupMembers,
);

router.delete(
  '/groups/:groupId/members/:staffId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.GROUPS_MANAGE_MEMBERS),
  validate({ params: groupsDto.platformGroupMemberParamsDto }),
  platformGroupsController.removePlatformGroupMember,
);

router.get(
  '/groups/:groupId/roles',
  requirePlatformPermission(PLATFORM_PERMISSIONS.GROUPS_READ),
  validate({ params: groupsDto.groupIdParamDto }),
  platformGroupsController.listPlatformGroupRoles,
);

router.post(
  '/groups/:groupId/roles',
  requirePlatformPermission([
    PLATFORM_PERMISSIONS.GROUPS_UPDATE,
    PLATFORM_PERMISSIONS.ROLES_MANAGE,
  ]),
  validate({ params: groupsDto.groupIdParamDto, body: groupsDto.bindRoleDto }),
  platformGroupsController.bindPlatformGroupRole,
);

router.delete(
  '/groups/:groupId/roles/:roleId',
  requirePlatformPermission([
    PLATFORM_PERMISSIONS.GROUPS_UPDATE,
    PLATFORM_PERMISSIONS.ROLES_MANAGE,
  ]),
  validate({ params: groupsDto.groupRoleParamsDto }),
  platformGroupsController.unbindPlatformGroupRole,
);

router.get(
  '/groups/:groupId/permissions',
  requirePlatformPermission(PLATFORM_PERMISSIONS.GROUPS_READ),
  validate({ params: groupsDto.groupIdParamDto }),
  platformGroupsController.getPlatformGroupPermissions,
);

router.get(
  '/groups/:groupId/policies',
  requirePlatformPermission(PLATFORM_PERMISSIONS.GROUPS_READ),
  validate({ params: groupsDto.groupIdParamDto }),
  platformGroupsController.listPlatformGroupPolicies,
);

router.post(
  '/groups/:groupId/policies',
  requirePlatformPermission([
    PLATFORM_PERMISSIONS.GROUPS_UPDATE,
    PLATFORM_PERMISSIONS.ROLES_MANAGE,
  ]),
  validate({ params: groupsDto.groupIdParamDto, body: groupsDto.bindPolicyDto }),
  platformGroupsController.bindPlatformGroupPolicy,
);

router.delete(
  '/groups/:groupId/policies/:policyId',
  requirePlatformPermission([
    PLATFORM_PERMISSIONS.GROUPS_UPDATE,
    PLATFORM_PERMISSIONS.ROLES_MANAGE,
  ]),
  validate({ params: groupsDto.groupPolicyParamsDto }),
  platformGroupsController.unbindPlatformGroupPolicy,
);

// ==========================================
// 8. Platform PBAC Policies
// ==========================================
router.get(
  '/policies',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ROLES_READ),
  validate({ query: policiesDto.listPoliciesQueryDto }),
  policiesController.listPlatformPolicies,
);

router.post(
  '/policies',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ROLES_MANAGE),
  validate({ body: policiesDto.createPolicyDto }),
  policiesController.createPlatformPolicy,
);

router.get(
  '/policies/:policyId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ROLES_READ),
  validate({ params: policiesDto.policyIdParamDto }),
  policiesController.getPlatformPolicy,
);

router.patch(
  '/policies/:policyId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ROLES_MANAGE),
  validate({ params: policiesDto.policyIdParamDto, body: policiesDto.updatePolicyDto }),
  policiesController.updatePlatformPolicy,
);

router.delete(
  '/policies/:policyId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ROLES_MANAGE),
  validate({ params: policiesDto.policyIdParamDto }),
  policiesController.deletePlatformPolicy,
);

router.post(
  '/policies/:policyId/roles/:roleId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ROLES_MANAGE),
  validate({ params: policiesDto.policyRoleParamDto }),
  policiesController.attachPolicyToPlatformRole,
);

router.delete(
  '/policies/:policyId/roles/:roleId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ROLES_MANAGE),
  validate({ params: policiesDto.policyRoleParamDto }),
  policiesController.detachPolicyFromPlatformRole,
);

router.get(
  '/policies/roles/:roleId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.ROLES_READ),
  validate({ params: policiesDto.roleIdParamDto }),
  policiesController.getPoliciesForPlatformRole,
);

export default router;
