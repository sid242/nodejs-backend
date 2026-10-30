import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { db } from '@/config/db';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { type Database } from '@/config/db';
import * as schema from '@/db/schema/index';
import {
  checkTenantDbHealth,
  closeDedicatedPool,
  getDedicatedPoolStats,
} from '@/lib/db-manager';
import type { MigrateTenantDatabaseDto } from './platform.dto';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import {
  appModules,
  platformPermissions,
  tenantBrandings,
  tenantModules,
} from '@/db/schema';
import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import { provisionDedicatedDatabase } from '@/lib/provision-db';
import * as authRepo from '@/modules/auth/auth.repository';
import {
  createMagicLinkToken,
  issueSupportToken,
} from '@/modules/auth/tokens';
import * as billingService from '@/modules/billing/billing.service';
import { rbacRepo } from '@/modules/rbac/rbac.repository';
import * as rbacService from '@/modules/rbac/rbac.service';
import { tenantsRepo } from '@/modules/tenants/tenants.repository';
import { buildPlatformUrl, buildTenantUrl } from '@/modules/tenants/tenant-url.service';
import { emailQueue } from '@/queues/index';

import { createPlatformTwoFactorChallenge } from './platform-2fa.service';
import type {
  CreatePlatformRoleDto,
  CreateStaffDto,
  ListPlatformTenantsQueryDto,
  ListStaffQueryDto,
  LoginStaffDto,
  ProvisionTenantDto,
  QueryPlatformAuditLogsDto,
  StartSupportSessionDto,
  UpdatePlatformRoleDto,
  UpdatePlatformTenantDto,
  UpdatePlatformTenantSubscriptionDto,
  UpdateStaffDto,
} from './platform.dto';
import {
  PLATFORM_PERMISSION_CATALOGUE,
  PLATFORM_PERMISSIONS,
  SYSTEM_PLATFORM_ROLES,
} from './platform.permissions';
import * as platformRepo from './platform.repository';

// ==========================================
// 1. Staff Management & Authentication
// ==========================================

export async function loginStaff(
  data: LoginStaffDto,
  ipAddress?: string,
  userAgent?: string,
  requestId?: string,
) {
  const staff = await platformRepo.findStaffByEmail(data.email.toLowerCase().trim());
  if (!staff) throw AppError.unauthorized('Invalid email or password');

  if (staff.status !== 'ACTIVE') {
    throw AppError.forbidden(`Platform staff account is ${staff.status.toLowerCase()}`);
  }

  const valid = await bcrypt.compare(data.password, staff.passwordHash);
  if (!valid) throw AppError.unauthorized('Invalid email or password');

  // Intercept if 2FA is active on the platform staff account
  if (staff.twoFactorEnabledAt) {
    return createPlatformTwoFactorChallenge(staff.id);
  }

  await platformRepo.updateStaffLastLogin(staff.id);

  const permissions = await platformRepo.getRolePermissionKeys(staff.roleId);
  const role = await platformRepo.findRoleById(staff.roleId);

  const token = jwt.sign(
    {
      sub: staff.id,
      email: staff.email,
      type: 'PLATFORM_STAFF',
      typ: 'STAFF',
      roleKey: role?.key ?? 'STAFF',
      roleId: staff.roleId,
    },
    env.JWT_PLATFORM_SECRET,
    { audience: 'platform-api', expiresIn: '8h' },
  );

  await platformRepo.logPlatformAction({
    actorStaffId: staff.id,
    action: 'platform_staff.login',
    targetType: 'staff',
    targetId: staff.id,
    metadata: { ip: ipAddress, userAgent },
    requestId,
  });

  return {
    token,
    staff: {
      id: staff.id,
      email: staff.email,
      displayName: staff.displayName,
      roleId: staff.roleId,
      roleKey: role?.key ?? 'STAFF',
      roleName: role?.name ?? 'Staff Member',
      permissions,
    },
  };
}

export async function listStaff(filters: ListStaffQueryDto) {
  return platformRepo.findStaffPaginated(filters);
}

export async function getStaffById(id: string) {
  const staff = await platformRepo.findStaffById(id);
  if (!staff) throw AppError.notFound('Platform staff member not found');
  return staff;
}

export interface StaffActorContext {
  id: string;
  roleKey?: string;
  permissions?: string[];
}

async function resolveActorContext(
  actor: string | StaffActorContext,
): Promise<Required<StaffActorContext>> {
  if (typeof actor !== 'string') {
    if (actor.roleKey && actor.permissions) {
      return {
        id: actor.id,
        roleKey: actor.roleKey,
        permissions: actor.permissions,
      };
    }
    const staff = await platformRepo.findStaffById(actor.id);
    const permissions = staff ? await platformRepo.getRolePermissionKeys(staff.roleId) : [];
    return {
      id: actor.id,
      roleKey: actor.roleKey ?? staff?.roleKey ?? 'STAFF',
      permissions: actor.permissions ?? permissions,
    };
  }
  const staff = await platformRepo.findStaffById(actor);
  const permissions = staff ? await platformRepo.getRolePermissionKeys(staff.roleId) : [];
  return {
    id: actor,
    roleKey: staff?.roleKey ?? 'STAFF',
    permissions,
  };
}

export async function createStaff(
  actor: string | StaffActorContext,
  data: CreateStaffDto,
  requestId?: string,
) {
  const actorCtx = await resolveActorContext(actor);
  const existing = await platformRepo.findStaffByEmail(data.email);
  if (existing) throw AppError.conflict('Staff member with this email already exists');

  const role = await platformRepo.findRoleById(data.roleId);
  if (!role || !role.isActive)
    throw AppError.badRequest('Assigned platform role is invalid or inactive');

  // Escalation guard: Only SUPER_ADMIN can assign the SUPER_ADMIN role
  if (role.key === 'SUPER_ADMIN' && actorCtx.roleKey !== 'SUPER_ADMIN') {
    throw AppError.forbidden('Only Super Admins can assign the SUPER_ADMIN role');
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const created = await platformRepo.createStaff({
    email: data.email,
    displayName: data.displayName,
    passwordHash,
    roleId: data.roleId,
    status: 'ACTIVE',
  });

  await platformRepo.logPlatformAction({
    actorStaffId: actorCtx.id,
    action: 'platform_staff.created',
    targetType: 'staff',
    targetId: created.id,
    metadata: { email: created.email, roleKey: role.key },
    requestId,
  });

  // Dispatch onboarding email with credentials and platform portal login link

  const loginUrl = buildPlatformUrl('/platform/login');

  try {
    await emailQueue.add(
      'staff-credentials',
      {
        to: created.email,
        name: created.displayName,
        email: created.email,
        password: data.password,
        roleName: role.name,
        loginUrl,
      },
      { jobId: `staff-credentials-${created.id}-${Date.now()}` },
    );
  } catch (emailErr) {
    logger.error({ err: emailErr, staffId: created.id }, 'Failed to queue staff credentials email');
  }

  return created;
}

export async function updateStaff(
  actor: string | StaffActorContext,
  staffId: string,
  data: UpdateStaffDto,
  requestId?: string,
) {
  const actorCtx = await resolveActorContext(actor);

  // Self role/status modification guard
  if (actorCtx.id === staffId && (data.roleId !== undefined || data.status !== undefined)) {
    throw AppError.badRequest('A staff member cannot change their own role or status');
  }

  const staff = await platformRepo.findStaffById(staffId);
  if (!staff) throw AppError.notFound('Platform staff member not found');

  if (data.roleId) {
    const role = await platformRepo.findRoleById(data.roleId);
    if (!role || !role.isActive) {
      throw AppError.badRequest('Assigned platform role is invalid or inactive');
    }

    const currentRoleKey = staff.roleKey;
    const newRoleKey = role.key;

    // Only SUPER_ADMIN may assign or remove the SUPER_ADMIN role
    if (
      (newRoleKey === 'SUPER_ADMIN' || currentRoleKey === 'SUPER_ADMIN') &&
      actorCtx.roleKey !== 'SUPER_ADMIN'
    ) {
      throw AppError.forbidden('Only Super Admins can assign or remove the SUPER_ADMIN role');
    }

    // Last Super Admin invariant: ensure at least one active SUPER_ADMIN remains
    if (currentRoleKey === 'SUPER_ADMIN' && newRoleKey !== 'SUPER_ADMIN') {
      const activeSuperAdminCount = await platformRepo.countActiveSuperAdmins();
      if (activeSuperAdminCount <= 1) {
        throw AppError.badRequest('Cannot demote the last remaining active Super Admin');
      }
    }
  }

  if (data.status) {
    const hasDisablePerm =
      actorCtx.roleKey === 'SUPER_ADMIN' ||
      actorCtx.permissions?.includes('*') ||
      actorCtx.permissions?.includes('platform_staff::disable');

    if (!hasDisablePerm) {
      throw AppError.forbidden('Status changes require platform_staff::disable permission');
    }

    if (data.status === 'SUSPENDED' || data.status === 'DEACTIVATED') {
      if (staff.roleKey === 'SUPER_ADMIN') {
        if (actorCtx.roleKey !== 'SUPER_ADMIN') {
          throw AppError.forbidden('Only Super Admins can disable a Super Admin');
        }
        const activeSuperAdminCount = await platformRepo.countActiveSuperAdmins();
        if (activeSuperAdminCount <= 1) {
          throw AppError.badRequest('Cannot disable the last remaining active Super Admin');
        }
      }
    }
  }

  const updated = await platformRepo.updateStaff(staffId, data);
  if (!updated) throw AppError.notFound('Failed to update staff member');

  await platformRepo.logPlatformAction({
    actorStaffId: actorCtx.id,
    action: 'platform_staff.updated',
    targetType: 'staff',
    targetId: staffId,
    metadata: { changes: data },
    requestId,
  });

  return updated;
}

export async function suspendStaff(
  actor: string | StaffActorContext,
  staffId: string,
  reason?: string,
  requestId?: string,
) {
  const actorCtx = await resolveActorContext(actor);

  if (actorCtx.id === staffId) {
    throw AppError.badRequest('You cannot suspend your own staff account');
  }

  const staff = await platformRepo.findStaffById(staffId);
  if (!staff) throw AppError.notFound('Platform staff member not found');

  if (staff.roleKey === 'SUPER_ADMIN') {
    if (actorCtx.roleKey !== 'SUPER_ADMIN') {
      throw AppError.forbidden('Only Super Admins can suspend a Super Admin');
    }
    const activeSuperAdminCount = await platformRepo.countActiveSuperAdmins();
    if (activeSuperAdminCount <= 1) {
      throw AppError.badRequest('Cannot suspend the last remaining active Super Admin');
    }
  }

  const updated = await platformRepo.updateStaff(staffId, { status: 'SUSPENDED' });

  await cache.del(`platform:staff:${staffId}:permissions`);

  await platformRepo.logPlatformAction({
    actorStaffId: actorCtx.id,
    action: 'platform_staff.suspended',
    targetType: 'staff',
    targetId: staffId,
    metadata: { reason },
    requestId,
  });

  return updated;
}

export async function activateStaff(actorStaffId: string, staffId: string, requestId?: string) {
  const staff = await platformRepo.findStaffById(staffId);
  if (!staff) throw AppError.notFound('Platform staff member not found');

  const updated = await platformRepo.updateStaff(staffId, { status: 'ACTIVE' });

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'platform_staff.activated',
    targetType: 'staff',
    targetId: staffId,
    requestId,
  });

  return updated;
}

export async function resetStaffPassword(
  actorStaffId: string,
  staffId: string,
  newPassword?: string,
  requestId?: string,
) {
  const staff = await platformRepo.findStaffById(staffId);
  if (!staff) throw AppError.notFound('Platform staff member not found');

  const plainPassword = newPassword || randomUUID().slice(0, 12);
  const passwordHash = await bcrypt.hash(plainPassword, 12);

  await platformRepo.updateStaff(staffId, { passwordHash });

  await cache.del(`platform:staff:${staffId}:permissions`);

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'platform_staff.password_reset',
    targetType: 'staff',
    targetId: staffId,
    requestId,
  });

  return {
    message: 'Staff password reset successfully',
    temporaryPassword: newPassword ? undefined : plainPassword,
  };
}

// ==========================================
// 2. Platform Roles & Permissions
// ==========================================

export async function listRoles() {
  return platformRepo.listRoles();
}

export async function getRoleById(id: string) {
  const role = await platformRepo.findRoleById(id);
  if (!role) throw AppError.notFound('Platform role not found');
  const permissions = await platformRepo.getRolePermissionKeys(id);
  return { ...role, permissions };
}

export async function createRole(
  actorStaffId: string,
  data: CreatePlatformRoleDto,
  requestId?: string,
) {
  const existing = await platformRepo.findRoleByKey(data.key);
  if (existing) throw AppError.conflict(`Platform role with key "${data.key}" already exists`);

  const matchedPermissions = await platformRepo.findPermissionsByKeys(data.permissionKeys);
  if (matchedPermissions.length !== data.permissionKeys.length) {
    throw AppError.badRequest(
      'One or more specified permission keys do not exist in the catalogue',
    );
  }

  const permissionIds = matchedPermissions.map((p) => p.id);
  const created = await platformRepo.createRole(
    {
      key: data.key,
      name: data.name,
      description: data.description,
      isSystem: false,
      isActive: true,
    },
    permissionIds,
  );

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'platform_role.created',
    targetType: 'role',
    targetId: created.id,
    metadata: { key: created.key, permissions: data.permissionKeys },
    requestId,
  });

  return { ...created, permissions: data.permissionKeys };
}

export async function updateRole(
  actorStaffId: string,
  roleId: string,
  data: UpdatePlatformRoleDto,
  requestId?: string,
) {
  const role = await platformRepo.findRoleById(roleId);
  if (!role) throw AppError.notFound('Platform role not found');

  if (role.isSystem && data.isActive === false) {
    throw AppError.forbidden('System platform roles cannot be deactivated');
  }

  let permissionIds: string[] | undefined;
  if (data.permissionKeys) {
    const matched = await platformRepo.findPermissionsByKeys(data.permissionKeys);
    if (matched.length !== data.permissionKeys.length) {
      throw AppError.badRequest('One or more specified permission keys do not exist');
    }
    permissionIds = matched.map((p) => p.id);
  }

  const updated = await platformRepo.updateRole(
    roleId,
    {
      ...(data.name ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
    permissionIds,
  );

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'platform_role.updated',
    targetType: 'role',
    targetId: roleId,
    metadata: { changes: data },
    requestId,
  });

  const permissions = await platformRepo.getRolePermissionKeys(roleId);
  return { ...updated, permissions };
}

export async function listPermissions() {
  return platformRepo.listPermissions();
}

// ==========================================
// 3. Audited Support Sessions
// ==========================================

export async function startSupportSession(
  actor: string | StaffActorContext,
  tenantId: string,
  data: StartSupportSessionDto,
  requestId?: string,
) {
  const actorCtx = await resolveActorContext(actor);

  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant || tenant.deletedAt) {
    throw AppError.notFound('Tenant organization not found');
  }

  // 1. Permission checks for scope & mode
  if (
    data.scope === 'FULL' &&
    !actorCtx.permissions.includes(PLATFORM_PERMISSIONS.SUPPORT_WRITE) &&
    actorCtx.roleKey !== 'SUPER_ADMIN'
  ) {
    throw AppError.forbidden('Requires tenant_support::write permission for FULL scope support sessions');
  }

  if (
    data.mode === 'AS_MEMBER' &&
    !actorCtx.permissions.includes(PLATFORM_PERMISSIONS.SUPPORT_IMPERSONATE) &&
    actorCtx.roleKey !== 'SUPER_ADMIN'
  ) {
    throw AppError.forbidden('Requires tenant_support::impersonate permission for AS_MEMBER mode support sessions');
  }

  // DEFAULT: AS_MEMBER + FULL additionally requires the tenant not to have allowSupportAccess = false
  if (
    data.mode === 'AS_MEMBER' &&
    data.scope === 'FULL' &&
    (tenant as any).allowSupportAccess === false
  ) {
    throw AppError.forbidden('This workspace has disabled full impersonation support access');
  }

  let targetUserId = data.targetUserId;
  let targetMemberId = data.targetMemberId;

  // 2. Validate target member if AS_MEMBER mode
  if (data.mode === 'AS_MEMBER') {
    let member = null;
    if (targetMemberId) {
      member = await tenantsRepo.findTenantMemberById(targetMemberId);
    } else if (targetUserId) {
      member = await tenantsRepo.findTenantMember(tenantId, targetUserId);
    }

    if (!member || member.status !== 'ACTIVE' || member.tenantId !== tenantId) {
      throw AppError.badRequest('Target member not found or is not active in this workspace');
    }

    targetMemberId = member.id;
    targetUserId = member.userId;

    // Target is not OWNER unless caller is SUPER_ADMIN
    const resolvedTarget = await rbacService.resolveUserPermissions(tenantId, targetUserId);
    const isOwner = resolvedTarget.roles.some((r) => r.toUpperCase() === rbacService.SYSTEM_ROLES.OWNER);
    if (isOwner && actorCtx.roleKey !== 'SUPER_ADMIN') {
      throw AppError.forbidden('Only Super Admin may initiate a support session targeting a workspace Owner');
    }
  }

  const durationMinutes = Math.min(120, Math.max(5, data.durationMinutes ?? 30));
  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

  const session = await platformRepo.createSupportSession({
    staffId: actorCtx.id,
    tenantId,
    mode: data.mode,
    scope: data.scope,
    targetUserId: targetUserId ?? null,
    targetMemberId: targetMemberId ?? null,
    reason: data.reason,
    ticketRef: data.ticketRef,
    status: 'ACTIVE',
    expiresAt,
  });

  await platformRepo.logPlatformAction({
    actorStaffId: actorCtx.id,
    action: 'tenant_support.started',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    metadata: {
      sessionId: session.id,
      mode: data.mode,
      scope: data.scope,
      ticketRef: data.ticketRef,
      reason: data.reason,
      durationMinutes,
      targetUserId,
      targetMemberId,
      expiresAt: expiresAt.toISOString(),
    },
    requestId,
  });

  return {
    sessionId: session.id,
    tenantId,
    mode: session.mode,
    scope: session.scope,
    targetUserId: session.targetUserId ?? null,
    targetMemberId: session.targetMemberId ?? null,
    ticketRef: session.ticketRef,
    reason: session.reason,
    expiresAt,
    status: session.status,
  };
}

export async function enterSupportSession(
  actorStaffId: string,
  sessionId: string,
  requestId?: string,
) {
  const session = await platformRepo.findSupportSessionById(sessionId);
  if (!session) throw AppError.notFound('Support session not found');

  if (session.staffId !== actorStaffId) {
    throw AppError.forbidden('Only the initiating staff member may enter this support session');
  }

  if (session.status !== 'ACTIVE') {
    throw AppError.forbidden(`Support session is currently ${session.status.toLowerCase()}`);
  }

  const remainingSeconds = Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000);
  if (remainingSeconds <= 0) {
    await platformRepo.terminateSupportSession(sessionId, { status: 'EXPIRED' });
    throw AppError.badRequest('Support session has expired');
  }

  const durationMinutes = Math.min(120, Math.ceil(remainingSeconds / 60));
  const { token, expiresInSeconds } = issueSupportToken(
    {
      sess: session.id,
      staffId: session.staffId,
      tenantId: session.tenantId,
      mode: session.mode as 'TENANT_SCOPED' | 'AS_MEMBER',
      scope: session.scope as 'READ_ONLY' | 'FULL',
      targetUserId: session.targetUserId,
    },
    durationMinutes,
  );

  const tenant = await tenantsRepo.findTenantById(session.tenantId);

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant_support.entered',
    targetType: 'tenant',
    targetId: session.tenantId,
    tenantId: session.tenantId,
    metadata: { sessionId, mode: session.mode, scope: session.scope },
    requestId,
  });

  return {
    token,
    expiresInSeconds,
    sessionId: session.id,
    tenantId: session.tenantId,
    tenantSlug: tenant?.slug,
    mode: session.mode,
    scope: session.scope,
  };
}

export async function listTenantMembers(tenantId: string) {
  return platformRepo.findTenantMembers(tenantId);
}

export async function endSupportSession(
  actor: string | StaffActorContext,
  sessionId: string,
  outcome?: string,
  requestId?: string,
) {
  const actorCtx = await resolveActorContext(actor);
  const session = await platformRepo.findSupportSessionById(sessionId);
  if (!session) throw AppError.notFound('Support session not found');

  const isSuperAdmin = actorCtx.roleKey === 'SUPER_ADMIN';
  const hasEndAny = actorCtx.permissions.includes(PLATFORM_PERMISSIONS.SUPPORT_END_ANY);
  if (session.staffId !== actorCtx.id && !isSuperAdmin && !hasEndAny) {
    throw AppError.forbidden(
      'Only the initiating staff member or Super Admin may terminate this session',
    );
  }

  const terminated = await platformRepo.terminateSupportSession(sessionId, {
    endedByStaffId: actorCtx.id,
    endOutcome: outcome,
    status: 'TERMINATED',
  });

  await platformRepo.logPlatformAction({
    actorStaffId: actorCtx.id,
    action: 'tenant_support.ended',
    targetType: 'tenant',
    targetId: session.tenantId,
    tenantId: session.tenantId,
    metadata: { sessionId, outcome },
    requestId,
  });

  return terminated;
}

export async function listSupportSessions(filters?: { page?: number; limit?: number }) {
  return platformRepo.listSupportSessionsPaginated(filters);
}

// ==========================================
// 4. Audit Trail Queries
// ==========================================

export async function queryAuditLogs(filters: QueryPlatformAuditLogsDto) {
  return platformRepo.queryPlatformAuditLogs(filters);
}

// ==========================================
// 5. Schema Seeder for Canonical Platform Permissions & System Roles
// ==========================================

export async function seedPlatformDefaults(): Promise<void> {
  // 1. Ensure all canonical permissions exist in database
  for (const perm of PLATFORM_PERMISSION_CATALOGUE) {
    await db
      .insert(platformPermissions)
      .values({
        key: perm.key,
        name: perm.name,
        description: perm.description,
        resource: perm.resource,
        action: perm.action,
      })
      .onConflictDoNothing();
  }

  // 2. Ensure system platform roles exist
  for (const roleDef of Object.values(SYSTEM_PLATFORM_ROLES)) {
    const existing = await platformRepo.findRoleByKey(roleDef.key);
    if (!existing) {
      const perms = await platformRepo.findPermissionsByKeys(roleDef.permissions as string[]);
      await platformRepo.createRole(
        {
          key: roleDef.key,
          name: roleDef.name,
          description: roleDef.description,
          isSystem: true,
          isActive: true,
        },
        perms.map((p) => p.id),
      );
    }
  }
}

// ==========================================
// 6. Platform Tenant Oversight & Provisioning
// ==========================================

export async function listTenants(filters: ListPlatformTenantsQueryDto) {
  return platformRepo.findTenantsPaginated(filters);
}

export async function getTenantById(id: string) {
  const tenant = await platformRepo.findTenantDetailById(id);
  if (!tenant) throw AppError.notFound('Tenant organization not found');
  return tenant;
}

export async function provisionTenant(
  actorStaffId: string,
  data: ProvisionTenantDto,
  requestId?: string,
) {
  const normalizedSlug = data.slug.toLowerCase().trim();
  const existing = await tenantsRepo.findTenantBySlug(normalizedSlug);
  if (existing) {
    throw AppError.conflict(`A workspace with slug "${normalizedSlug}" already exists`);
  }

  const isDedicated = data.databaseMode === 'dedicated';
  const tenantId = randomUUID();
  const configuredDatabaseKey = data.databaseConfig?.databaseKey?.trim();
  const databaseKey = isDedicated ? (configuredDatabaseKey || `dedicated-${tenantId}`) : 'primary';

  // 1. Create tenant organization record
  const tenant = await tenantsRepo.createTenant({
    id: tenantId,
    name: data.name.trim(),
    slug: normalizedSlug,
    plan: isDedicated ? 'ENTERPRISE' : (data.plan ?? 'FREE'),
    status: 'ACTIVE',
    databaseMode: isDedicated ? 'dedicated' : 'shared',
    databaseKey,
    metadata: {
      country: data?.country ?? null,
      timezone: data?.timezone ?? 'UTC',
      notes: data?.notes ?? null,
      provisionedByStaffId: actorStaffId,
    },
  });

  // Automatically provision dedicated database and execute Drizzle migrations
  if (isDedicated) {
    try {
      const dbResult = await provisionDedicatedDatabase(tenant.id, {
        customDatabaseName: data.databaseConfig?.databaseName,
        customDatabaseKey: databaseKey,
        poolLimit: data.databaseConfig?.poolLimit,
        connectionUrl: data.databaseConfig?.connectionUrl,
      });

      await tenantsRepo.updateTenant(tenant.id, {
        databaseKey: dbResult.databaseKey,
        metadata: {
          ...(tenant.metadata as Record<string, unknown> | null),
          databaseName: dbResult.databaseName,
          poolLimit: dbResult.poolLimit,
          schemaVersion: dbResult.schemaVersion,
          dbProvisionedAt: new Date().toISOString(),
        },
      });
    } catch (err: unknown) {
      logger.error({ err, tenantId: tenant.id }, 'Failed to provision dedicated database cluster');
      await tenantsRepo.updateTenant(tenant.id, {
        metadata: {
          ...(tenant.metadata as Record<string, unknown> | null),
          dbProvisioningError: (err as Error)?.message ?? 'Unknown database provisioning error',
        },
      });
    }
  }

  // 2. Resolve or provision owner user account
  const normalizedEmail = data.ownerEmail.toLowerCase().trim();
  let ownerUser = await authRepo.findByEmail(normalizedEmail);
  let isNewUser = false;

  if (!ownerUser) {
    const dummyHash = await bcrypt.hash(randomUUID(), 12);
    const namePart = normalizedEmail.split('@')[0] || 'Owner';
    const name = namePart.charAt(0).toUpperCase() + namePart.slice(1);
    const created = await authRepo.createUser({
      email: normalizedEmail,
      name,
      passwordHash: dummyHash,
    });
    ownerUser = await authRepo.findById(created.id);
    isNewUser = true;
  }

  if (!ownerUser) {
    throw AppError.internal('Failed to provision owner account for new workspace');
  }

  // 3. Add owner as invited tenant member (activated upon accepting the magic link onboarding URL)
  const member = await tenantsRepo.addTenantMember({
    tenantId: tenant.id,
    userId: ownerUser.id,
    status: 'INVITED',
  });

  // 4. Look up or seed OWNER system role
  const systemRoles = await rbacRepo.findRolesByTenant(null);
  let ownerRole = systemRoles.find((r) => r.name === rbacService.SYSTEM_ROLES.OWNER);

  if (!ownerRole) {
    await rbacService.seedDefaultRbac();
    const refreshed = await rbacRepo.findRolesByTenant(null);
    ownerRole = refreshed.find((r) => r.name === rbacService.SYSTEM_ROLES.OWNER);
  }

  if (ownerRole) {
    await rbacRepo.assignRoleToMember(member.id, ownerRole.id);
  }

  // 5. Provision default tenant modules
  const allModules = await db
    .select({ id: appModules.id })
    .from(appModules)
    .where(eq(appModules.isSystem, true));
  if (allModules.length > 0) {
    await db
      .insert(tenantModules)
      .values(
        allModules.map((m) => ({
          tenantId: tenant.id,
          moduleId: m.id,
          isEnabled: true,
        })),
      )
      .onConflictDoNothing();
  }

  // 6. Assign initial subscription
  await billingService.assignInitialSubscription(tenant.id, tenant.plan ?? 'FREE');

  // 7. Seed default branding record
  await db
    .insert(tenantBrandings)
    .values({
      tenantId: tenant.id,
      companyName: tenant.name,
      primaryColor: '#4F46E5',
      accentColor: '#06B6D4',
      borderRadius: '0.5rem',
      customDomainStatus: 'PENDING',
    })
    .onConflictDoNothing();

  // 8. Generate 48-hour invitation token and dispatch invitation email
  const inviteToken = await createMagicLinkToken(ownerUser.id, 48 * 3600, tenant.id);

  const inviteUrl = await buildTenantUrl(tenant.id, `/accept-invite?token=${inviteToken}&tenant=${tenant.id}`);

  await emailQueue.add(
    'tenant-invite',
    {
      to: ownerUser.email,
      name: ownerUser.name,
      tenantName: tenant.name,
      roleName: 'Owner',
      token: inviteToken,
      inviteUrl,
      tenantId: tenant.id,
    },
    { jobId: `provision-${tenant.id}-${ownerUser.id}-${Date.now()}` },
  );

  // 9. Write immutable platform audit log
  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.provisioned',
    targetType: 'tenant',
    targetId: tenant.id,
    tenantId: tenant.id,
    metadata: {
      name: tenant.name,
      slug: tenant.slug,
      ownerEmail: normalizedEmail,
      plan: tenant.plan,
      isNewUser,
      databaseMode: tenant.databaseMode,
    },
    requestId,
  });

  return {
    tenant,
    owner: {
      id: ownerUser.id,
      email: ownerUser.email,
      name: ownerUser.name,
      isNewUser,
    },
    inviteUrl,
    inviteToken,
  };
}

export async function updateTenant(
  actorStaffId: string,
  id: string,
  data: UpdatePlatformTenantDto,
  requestId?: string,
) {
  const existing = await platformRepo.findTenantDetailById(id);
  if (!existing) throw AppError.notFound('Tenant not found');

  const updated = await platformRepo.updateTenantPlatformFields(id, {
    ...(data?.name ? { name: data.name.trim() } : {}),
    ...(data?.plan ? { plan: data.plan } : {}),
    ...(data?.databaseMode ? { databaseMode: data.databaseMode } : {}),
    ...(data?.notes
      ? {
          metadata: {
            ...(typeof existing.metadata === 'object' && existing.metadata
              ? existing.metadata
              : {}),
            notes: data.notes,
          },
        }
      : {}),
  });

  if (!updated) throw AppError.notFound('Failed to update tenant');

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.updated',
    targetType: 'tenant',
    targetId: id,
    tenantId: id,
    metadata: { changes: data },
    requestId,
  });

  return updated;
}

export async function suspendTenant(
  actorStaffId: string,
  id: string,
  reason: string,
  requestId?: string,
) {
  const existing = await platformRepo.findTenantDetailById(id);
  if (!existing) throw AppError.notFound('Tenant not found');

  if (existing.status === 'SUSPENDED') {
    throw AppError.badRequest('Tenant organization is already suspended');
  }

  const updated = await platformRepo.updateTenantPlatformFields(id, {
    status: 'SUSPENDED',
  });

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.suspended',
    targetType: 'tenant',
    targetId: id,
    tenantId: id,
    metadata: { reason, previousStatus: existing.status },
    requestId,
  });

  return updated;
}

export async function activateTenant(
  actorStaffId: string,
  id: string,
  reason?: string,
  requestId?: string,
) {
  const existing = await platformRepo.findTenantDetailById(id);
  if (!existing) throw AppError.notFound('Tenant not found');

  if (existing.status === 'ACTIVE') {
    throw AppError.badRequest('Tenant organization is already active');
  }

  const updated = await platformRepo.updateTenantPlatformFields(id, {
    status: 'ACTIVE',
  });

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.activated',
    targetType: 'tenant',
    targetId: id,
    tenantId: id,
    metadata: { reason, previousStatus: existing.status },
    requestId,
  });

  return updated;
}

export async function getTenantSubscription(tenantId: string) {
  const subscription = await platformRepo.findSubscriptionByTenantId(tenantId);
  if (!subscription) throw AppError.notFound('No subscription record found for this tenant');
  return subscription;
}

export async function updateTenantSubscription(
  actorStaffId: string,
  tenantId: string,
  data: UpdatePlatformTenantSubscriptionDto,
  requestId?: string,
) {
  const existing = await platformRepo.findSubscriptionByTenantId(tenantId);
  if (!existing) throw AppError.notFound('No subscription record found for this tenant');

  const updated = await platformRepo.updateTenantSubscription(tenantId, {
    ...(data?.planId ? { planId: data.planId } : {}),
    ...(data?.seatCount !== undefined ? { seatCount: data.seatCount } : {}),
    ...(data?.status ? { status: data.status } : {}),
    ...(data?.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: data.cancelAtPeriodEnd } : {}),
    ...(data?.currentPeriodEnd ? { currentPeriodEnd: new Date(data.currentPeriodEnd) } : {}),
  });

  if (!updated) throw AppError.notFound('Failed to update tenant subscription');

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.subscription_updated',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    metadata: { changes: data },
    requestId,
  });

  return updated;
}


// ==========================================
// 8. Tenant Database Routing & Lifecycle Management
// ==========================================

export async function migrateTenantToDedicated(
  actorStaffId: string,
  tenantId: string,
  options?: MigrateTenantDatabaseDto,
  requestId?: string,
) {
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  if (!tenant) throw AppError.notFound('Tenant not found');

  if (tenant.databaseMode === 'dedicated') {
    throw AppError.conflict('Tenant is already running on an isolated dedicated database');
  }

  const defaultSanitizedId = tenant.id.replace(/-/g, '_');
  const databaseName = options?.customDatabaseName?.trim() || `tenant_${defaultSanitizedId}`;
  const databaseKey = `dedicated-${tenant.id}`;
  const poolLimit = options?.poolLimit ?? 5;
  const connectionUrl = options?.connectionUrl?.trim() || env.DATABASE_URL;

  // Step 1: Provision dedicated PostgreSQL database and apply Drizzle migrations
  const dbResult = await provisionDedicatedDatabase(tenant.id, {
    customDatabaseName: databaseName,
    customDatabaseKey: databaseKey,
    poolLimit,
    connectionUrl,
  });

  // Step 2: Open temporary direct connection to newly provisioned database
  const targetUrl = new URL(connectionUrl);
  targetUrl.pathname = `/${dbResult.databaseName}`;
  const dedicatedClient = postgres(targetUrl.toString(), { max: 2, idle_timeout: 10 });
  const dedicatedDb = drizzle({ client: dedicatedClient, schema }) as unknown as Database;

  const recordsMigrated = {
    members: 0,
    subscriptions: 0,
    invoices: 0,
    files: 0,
    modules: 0,
    branding: 0,
  };

  try {
    // 2a. Replicate tenant record
    await dedicatedDb
      .insert(schema.tenants)
      .values({
        ...tenant,
        databaseMode: 'dedicated',
        databaseKey: dbResult.databaseKey,
      })
      .onConflictDoNothing();

    // 2b. Replicate tenant branding
    const brandings = await db
      .select()
      .from(schema.tenantBrandings)
      .where(eq(schema.tenantBrandings.tenantId, tenant.id));
    if (brandings?.length) {
      await dedicatedDb.insert(schema.tenantBrandings).values(brandings).onConflictDoNothing();
      recordsMigrated.branding = brandings.length;
    }

    // 2c. Replicate tenant members & roles (replicate member user accounts first for FK integrity)
    const members = await db
      .select()
      .from(schema.tenantMembers)
      .where(eq(schema.tenantMembers.tenantId, tenant.id));
    if (members?.length) {
      const userIds = [...new Set(members.map((m) => m.userId))];
      if (userIds.length > 0) {
        const memberUsers = await db
          .select()
          .from(schema.users)
          .where(inArray(schema.users.id, userIds));
        if (memberUsers?.length) {
          await dedicatedDb.insert(schema.users).values(memberUsers).onConflictDoNothing();
        }
      }

      await dedicatedDb.insert(schema.tenantMembers).values(members).onConflictDoNothing();
      recordsMigrated.members = members.length;

      const memberIds = members.map((m) => m.id);
      if (memberIds.length > 0) {
        const memberRoles = await db
          .select()
          .from(schema.tenantMemberRoles)
          .where(inArray(schema.tenantMemberRoles.memberId, memberIds));
        if (memberRoles?.length) {
          await dedicatedDb.insert(schema.tenantMemberRoles).values(memberRoles).onConflictDoNothing();
        }
      }
    }

    // 2d. Replicate tenant custom roles
    const customRoles = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.tenantId, tenant.id));
    if (customRoles?.length) {
      await dedicatedDb.insert(schema.roles).values(customRoles).onConflictDoNothing();
    }

    // 2e. Replicate tenant modules
    const modules = await db
      .select()
      .from(schema.tenantModules)
      .where(eq(schema.tenantModules.tenantId, tenant.id));
    if (modules?.length) {
      await dedicatedDb.insert(schema.tenantModules).values(modules).onConflictDoNothing();
      recordsMigrated.modules = modules.length;
    }

    // 2f. Replicate subscriptions and subscription events
    const subs = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, tenant.id));
    if (subs?.length) {
      await dedicatedDb.insert(schema.subscriptions).values(subs).onConflictDoNothing();
      recordsMigrated.subscriptions = subs.length;

      const subEvents = await db
        .select()
        .from(schema.subscriptionEvents)
        .where(eq(schema.subscriptionEvents.tenantId, tenant.id));
      if (subEvents?.length) {
        await dedicatedDb.insert(schema.subscriptionEvents).values(subEvents).onConflictDoNothing();
      }
    }

    // 2g. Replicate invoices (line items are jsonb on the invoice record)
    const invs = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.tenantId, tenant.id));
    if (invs?.length) {
      await dedicatedDb.insert(schema.invoices).values(invs).onConflictDoNothing();
      recordsMigrated.invoices = invs.length;
    }

    // 2h. Replicate files
    const fileRecords = await db
      .select()
      .from(schema.files)
      .where(eq(schema.files.tenantId, tenant.id));
    if (fileRecords?.length) {
      await dedicatedDb.insert(schema.files).values(fileRecords).onConflictDoNothing();
      recordsMigrated.files = fileRecords.length;
    }
  } finally {
    await dedicatedClient.end({ timeout: 5 }).catch(() => {});
  }

  // Step 3: Atomically update central tenant registry in primary database
  const [updatedTenant] = await db
    .update(schema.tenants)
    .set({
      databaseMode: 'dedicated',
      databaseKey: dbResult.databaseKey,
      metadata: {
        ...(tenant.metadata as Record<string, unknown> | null),
        databaseName: dbResult.databaseName,
        poolLimit: dbResult.poolLimit,
        schemaVersion: dbResult.schemaVersion,
        connectionUrl: options?.connectionUrl ? options.connectionUrl : undefined,
        migratedToDedicatedAt: new Date().toISOString(),
        migratedByStaffId: actorStaffId,
      },
    })
    .where(eq(schema.tenants.id, tenant.id))
    .returning();

  // Invalidate any active pool in cache
  await closeDedicatedPool(dbResult.databaseKey);

  // Step 4: Record immutable platform audit entry
  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.database_migrated',
    targetType: 'tenant',
    targetId: tenant.id,
    tenantId: tenant.id,
    metadata: {
      previousMode: 'shared',
      newMode: 'dedicated',
      databaseName: dbResult.databaseName,
      databaseKey: dbResult.databaseKey,
      recordsMigrated,
    },
    requestId,
  });

  return {
    tenant: updatedTenant,
    databaseName: dbResult.databaseName,
    databaseKey: dbResult.databaseKey,
    recordsMigrated,
  };
}

export async function rollbackTenantToShared(
  actorStaffId: string,
  tenantId: string,
  requestId?: string,
) {
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  if (!tenant) throw AppError.notFound('Tenant not found');

  if (tenant.databaseMode !== 'dedicated') {
    throw AppError.badRequest('Tenant is not currently running on a dedicated database');
  }

  const previousKey = tenant.databaseKey;
  const [updatedTenant] = await db
    .update(schema.tenants)
    .set({
      databaseMode: 'shared',
      databaseKey: 'primary',
      metadata: {
        ...(tenant.metadata as Record<string, unknown> | null),
        rolledBackToSharedAt: new Date().toISOString(),
        rolledBackByStaffId: actorStaffId,
        previousDatabaseKey: previousKey,
      },
    })
    .where(eq(schema.tenants.id, tenant.id))
    .returning();

  // Close and evict dedicated pool
  await closeDedicatedPool(previousKey);

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.database_rollback_shared',
    targetType: 'tenant',
    targetId: tenant.id,
    tenantId: tenant.id,
    metadata: {
      previousMode: 'dedicated',
      newMode: 'shared',
      previousDatabaseKey: previousKey,
    },
    requestId,
  });

  return {
    tenant: updatedTenant,
    previousDatabaseKey: previousKey,
    rolledBackAt: new Date().toISOString(),
  };
}

export async function getTenantDatabaseHealth(tenantId: string) {
  const [tenant] = await db
    .select({
      id: schema.tenants.id,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  if (!tenant) throw AppError.notFound('Tenant not found');

  return checkTenantDbHealth(tenantId);
}

export function getDatabasePoolStats() {
  return getDedicatedPoolStats();
}
