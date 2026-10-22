import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { db } from '@/config/db.js';
import { env } from '@/config/env.js';
import { platformPermissions } from '@/db/schema/index.js';
import { AppError } from '@/lib/errors.js';

import type {
  CreatePlatformRoleDto,
  CreateStaffDto,
  ListStaffQueryDto,
  LoginStaffDto,
  QueryPlatformAuditLogsDto,
  StartSupportSessionDto,
  UpdatePlatformRoleDto,
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
