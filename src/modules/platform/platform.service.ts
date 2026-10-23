import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { db } from '@/config/db.js';
import { env } from '@/config/env.js';
import {
  appModules,
  platformPermissions,
  tenantBrandings,
  tenantModules,
} from '@/db/schema/index.js';
import { AppError } from '@/lib/errors.js';
import * as authRepo from '@/modules/auth/auth.repository.js';
import { createMagicLinkToken } from '@/modules/auth/tokens.js';
import * as plansService from '@/modules/plans/plans.service.js';
import { rbacRepo } from '@/modules/rbac/rbac.repository.js';
import * as rbacService from '@/modules/rbac/rbac.service.js';
import { tenantsRepo } from '@/modules/tenants/tenants.repository.js';
import { emailQueue } from '@/queues/index.js';

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
} from './platform.dto.js';
import { PLATFORM_PERMISSION_CATALOGUE, SYSTEM_PLATFORM_ROLES } from './platform.permissions.js';
import * as platformRepo from './platform.repository.js';

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

  await platformRepo.updateStaffLastLogin(staff.id);

  const permissions = await platformRepo.getRolePermissionKeys(staff.roleId);
  const role = await platformRepo.findRoleById(staff.roleId);

  const token = jwt.sign(
    {
      sub: staff.id,
      email: staff.email,
      type: 'PLATFORM_STAFF',
      roleKey: role?.key ?? 'STAFF',
      roleId: staff.roleId,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '8h' },
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

export async function createStaff(actorStaffId: string, data: CreateStaffDto, requestId?: string) {
  const existing = await platformRepo.findStaffByEmail(data.email);
  if (existing) throw AppError.conflict('Staff member with this email already exists');

  const role = await platformRepo.findRoleById(data.roleId);
  if (!role || !role.isActive)
    throw AppError.badRequest('Assigned platform role is invalid or inactive');

  const passwordHash = await bcrypt.hash(data.password, 12);
  const created = await platformRepo.createStaff({
    email: data.email,
    displayName: data.displayName,
    passwordHash,
    roleId: data.roleId,
    status: 'ACTIVE',
  });

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'platform_staff.created',
    targetType: 'staff',
    targetId: created.id,
    metadata: { email: created.email, roleKey: role.key },
    requestId,
  });

  return created;
}

export async function updateStaff(
  actorStaffId: string,
  staffId: string,
  data: UpdateStaffDto,
  requestId?: string,
) {
  const staff = await platformRepo.findStaffById(staffId);
  if (!staff) throw AppError.notFound('Platform staff member not found');

  if (data.roleId) {
    const role = await platformRepo.findRoleById(data.roleId);
    if (!role || !role.isActive) {
      throw AppError.badRequest('Assigned platform role is invalid or inactive');
    }
  }

  const updated = await platformRepo.updateStaff(staffId, data);
  if (!updated) throw AppError.notFound('Failed to update staff member');

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'platform_staff.updated',
    targetType: 'staff',
    targetId: staffId,
    metadata: { changes: data },
    requestId,
  });

  return updated;
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
  staffId: string,
  tenantId: string,
  data: StartSupportSessionDto,
  requestId?: string,
) {
  const expiresAt = new Date(Date.now() + data.durationMinutes * 60 * 1000);

  const session = await platformRepo.createSupportSession({
    staffId,
    tenantId,
    targetUserId: data.targetUserId,
    reason: data.reason,
    status: 'ACTIVE',
    expiresAt,
  });

  await platformRepo.logPlatformAction({
    actorStaffId: staffId,
    action: 'tenant_support.started',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    metadata: {
      sessionId: session.id,
      reason: data.reason,
      durationMinutes: data.durationMinutes,
      targetUserId: data.targetUserId,
      expiresAt: expiresAt.toISOString(),
    },
    requestId,
  });

  return {
    sessionId: session.id,
    tenantId,
    targetUserId: session.targetUserId ?? null,
    reason: data.reason,
    expiresAt,
    status: session.status,
  };
}

export async function endSupportSession(
  staffId: string,
  sessionId: string,
  outcome?: string,
  requestId?: string,
) {
  const session = await platformRepo.findSupportSessionById(sessionId);
  if (!session) throw AppError.notFound('Support session not found');

  if (session.staffId !== staffId) {
    throw AppError.forbidden(
      'Only the initiating staff member or Super Admin may terminate this session',
    );
  }

  const terminated = await platformRepo.terminateSupportSession(sessionId);

  await platformRepo.logPlatformAction({
    actorStaffId: staffId,
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

  // 1. Create tenant organization record
  const tenant = await tenantsRepo.createTenant({
    name: data.name.trim(),
    slug: normalizedSlug,
    plan: data.plan ?? 'FREE',
    status: 'ACTIVE',
    databaseMode: data.databaseMode ?? 'shared',
    metadata: {
      country: data?.country ?? null,
      timezone: data?.timezone ?? 'UTC',
      notes: data?.notes ?? null,
      provisionedByStaffId: actorStaffId,
    },
  });

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
  const allModules = await db.select({ id: appModules.id }).from(appModules);
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
  await plansService.assignInitialSubscription(tenant.id, tenant.plan ?? 'FREE');

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
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const inviteUrl = `${frontendUrl}/accept-invitation?token=${inviteToken}&tenant=${tenant.id}`;

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
            ...(typeof existing.metadata === 'object' && existing.metadata ? existing.metadata : {}),
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
    ...(data?.cancelAtPeriodEnd !== undefined
      ? { cancelAtPeriodEnd: data.cancelAtPeriodEnd }
      : {}),
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

