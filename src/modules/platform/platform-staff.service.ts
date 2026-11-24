import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

import { db } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { platformPermissions } from '@/db/schema';
import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import * as authRepo from '@/modules/auth/auth.repository';
import { buildPlatformUrl } from '@/modules/tenants/tenant-url.service';
import { emailQueue } from '@/queues/index';

import { createPlatformTwoFactorChallenge } from './platform-2fa.service';
import {
  type AcceptStaffInviteDto,
  type ChangePlatformPasswordDto,
  type CreatePlatformRoleDto,
  type CreateStaffDto,
  type InviteStaffDto,
  type ListStaffQueryDto,
  type LoginStaffDto,
  type UpdatePlatformProfileDto,
  type UpdatePlatformRoleDto,
  type UpdateStaffDto,
} from './platform.dto';
import {
  PLATFORM_PERMISSION_CATALOGUE,
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLES,
  SYSTEM_PLATFORM_ROLES,
} from './platform.permissions';
import * as platformRepo from './platform.repository';

const STAFF_LOGIN_DUMMY_HASH = bcrypt.hashSync('platform-login-placeholder', 12);

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
  const valid = await bcrypt.compare(data.password, staff?.passwordHash ?? STAFF_LOGIN_DUMMY_HASH);
  if (!valid || staff?.status !== 'ACTIVE') {
    throw AppError.unauthorized('Invalid email or password');
  }

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
  isSupportSession?: boolean;
}

export async function resolveActorContext(
  actor: string | StaffActorContext,
): Promise<Required<StaffActorContext>> {
  if (typeof actor !== 'string') {
    if (actor.roleKey && actor.permissions) {
      return {
        id: actor.id,
        roleKey: actor.roleKey,
        permissions: actor.permissions,
        isSupportSession: actor.isSupportSession ?? false,
      };
    }
    const staff = await platformRepo.findStaffById(actor.id);
    const permissions = staff ? await platformRepo.getRolePermissionKeys(staff.roleId) : [];
    return {
      id: actor.id,
      roleKey: actor.roleKey ?? staff?.roleKey ?? 'STAFF',
      permissions: actor.permissions ?? permissions,
      isSupportSession: actor.isSupportSession ?? false,
    };
  }
  const staff = await platformRepo.findStaffById(actor);
  const permissions = staff ? await platformRepo.getRolePermissionKeys(staff.roleId) : [];
  return {
    id: actor,
    roleKey: staff?.roleKey ?? 'STAFF',
    permissions,
    isSupportSession: false,
  };
}

export async function createStaff(
  actor: string | StaffActorContext,
  data: CreateStaffDto,
  requestId?: string,
) {
  const actorCtx = await resolveActorContext(actor);
  const existing = await platformRepo.findStaffByEmail(data.email.toLowerCase().trim());
  if (existing) throw AppError.conflict('Staff member with this email already exists');

  if (data.employeeCode) {
    const existingCode = await platformRepo.findStaffByEmployeeCode(data.employeeCode);
    if (existingCode)
      throw AppError.conflict('Staff member with this employee code already exists');
  }

  const role = await platformRepo.findRoleById(data.roleId);
  if (!role || !role.isActive)
    throw AppError.badRequest('Assigned platform role is invalid or inactive');

  // Escalation guard: Only SUPER_ADMIN can assign the SUPER_ADMIN role
  if (role.key === PLATFORM_ROLES.SUPER_ADMIN && actorCtx.roleKey !== PLATFORM_ROLES.SUPER_ADMIN) {
    throw AppError.forbidden('Only Super Admins can assign the SUPER_ADMIN role');
  }

  // Link to global identity if existing user exists
  const existingUser = await authRepo.findByEmail(data.email.toLowerCase().trim());

  const passwordHash = await bcrypt.hash(data.password, 12);
  const created = await platformRepo.createStaff({
    userId: existingUser?.id ?? null,
    email: data.email.toLowerCase().trim(),
    displayName: data.displayName,
    employeeCode: data.employeeCode ?? null,
    department: data.department ?? null,
    jobTitle: data.jobTitle ?? null,
    passwordHash,
    roleId: data.roleId,
    status: 'ACTIVE',
  });

  await platformRepo.logPlatformAction({
    actorStaffId: actorCtx.id,
    action: 'platform_staff.created',
    targetType: 'staff',
    targetId: created.id,
    metadata: {
      email: created.email,
      roleKey: role.key,
      employeeCode: data.employeeCode,
      department: data.department,
      userId: existingUser?.id,
    },
    requestId,
  });

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

export async function inviteStaff(
  actor: string | StaffActorContext,
  data: InviteStaffDto,
  requestId?: string,
) {
  const actorCtx = await resolveActorContext(actor);
  const cleanEmail = data.email.toLowerCase().trim();

  const existing = await platformRepo.findStaffByEmail(cleanEmail);
  if (existing) {
    throw AppError.conflict('Staff member with this email already exists');
  }

  if (data.employeeCode) {
    const existingCode = await platformRepo.findStaffByEmployeeCode(data.employeeCode);
    if (existingCode) {
      throw AppError.conflict('Staff member with this employee code already exists');
    }
  }

  const role = await platformRepo.findRoleById(data.roleId);
  if (!role || !role.isActive) {
    throw AppError.badRequest('Assigned platform role is invalid or inactive');
  }

  // Escalation guard: Only SUPER_ADMIN can invite a SUPER_ADMIN
  if (role.key === PLATFORM_ROLES.SUPER_ADMIN && actorCtx.roleKey !== PLATFORM_ROLES.SUPER_ADMIN) {
    throw AppError.forbidden('Only Super Admins can invite a Super Admin');
  }

  // Link to global identity if existing user exists
  const existingUser = await authRepo.findByEmail(cleanEmail);

  // Generate secure 32-byte single-use invitation token
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days

  // Generate un-usable password placeholder until invite is accepted
  const placeholderHash = await bcrypt.hash(randomUUID(), 10);

  const created = await platformRepo.createStaff({
    userId: existingUser?.id ?? null,
    email: cleanEmail,
    displayName: data.displayName,
    employeeCode: data.employeeCode ?? null,
    department: data.department ?? null,
    jobTitle: data.jobTitle ?? null,
    invitationMessage: data.invitationMessage ?? null,
    passwordHash: placeholderHash,
    roleId: data.roleId,
    status: 'INVITED',
    invitedAt: new Date(),
    inviteTokenHash: tokenHash,
    inviteExpiresAt: expiresAt,
  });

  await platformRepo.logPlatformAction({
    actorStaffId: actorCtx.id,
    action: 'platform_staff.invited',
    targetType: 'staff',
    targetId: created.id,
    metadata: {
      email: created.email,
      roleKey: role.key,
      employeeCode: data.employeeCode,
      department: data.department,
      userId: existingUser?.id,
    },
    requestId,
  });

  const inviteUrl = buildPlatformUrl(`/platform/invite?token=${rawToken}`);

  try {
    await emailQueue.add(
      'staff-invite',
      {
        to: created.email,
        name: created.displayName,
        email: created.email,
        roleName: role.name,
        inviteUrl,
        message: data.invitationMessage,
      },
      { jobId: `staff-invite-${created.id}-${Date.now()}` },
    );
  } catch (emailErr) {
    logger.error({ err: emailErr, staffId: created.id }, 'Failed to queue staff invitation email');
  }

  return {
    ...created,
    ...(process.env.NODE_ENV !== 'production' ? { inviteToken: rawToken, inviteUrl } : {}),
  };
}

export async function acceptStaffInvite(data: AcceptStaffInviteDto, requestId?: string) {
  const tokenHash = createHash('sha256').update(data.token).digest('hex');
  const staff = await platformRepo.findStaffByInviteTokenHash(tokenHash);

  if (!staff) {
    throw AppError.notFound('Invalid or expired staff invitation token');
  }

  if (staff.status !== 'INVITED') {
    throw AppError.badRequest('Staff invitation has already been accepted or is no longer valid');
  }

  if (!staff.inviteExpiresAt || new Date(staff.inviteExpiresAt) <= new Date()) {
    throw AppError.badRequest(
      'Staff invitation has expired. Please ask an administrator to resend it.',
    );
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const updated = await platformRepo.updateStaff(staff.id, {
    status: 'ACTIVE',
    passwordHash,
    inviteTokenHash: null,
    inviteExpiresAt: null,
  });

  await platformRepo.logPlatformAction({
    actorStaffId: staff.id,
    action: 'platform_staff.invite_accepted',
    targetType: 'staff',
    targetId: staff.id,
    metadata: { email: staff.email },
    requestId,
  });

  return updated;
}

export async function resendStaffInvite(
  actor: string | StaffActorContext,
  staffId: string,
  requestId?: string,
) {
  const actorCtx = await resolveActorContext(actor);
  const staff = await platformRepo.findStaffById(staffId);
  if (!staff) throw AppError.notFound('Staff member not found');

  if (staff.status !== 'INVITED') {
    throw AppError.badRequest('Can only resend invitations for staff members in INVITED status');
  }

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);

  await platformRepo.updateStaff(staffId, {
    inviteTokenHash: tokenHash,
    inviteExpiresAt: expiresAt,
  });

  await platformRepo.logPlatformAction({
    actorStaffId: actorCtx.id,
    action: 'platform_staff.invite_resent',
    targetType: 'staff',
    targetId: staffId,
    metadata: { email: staff.email },
    requestId,
  });

  const inviteUrl = buildPlatformUrl(`/platform/invite?token=${rawToken}`);

  try {
    await emailQueue.add(
      'staff-invite',
      {
        to: staff.email,
        name: staff.displayName,
        email: staff.email,
        roleName: staff.roleName,
        inviteUrl,
      },
      { jobId: `staff-resend-invite-${staffId}-${Date.now()}` },
    );
  } catch (emailErr) {
    logger.error({ err: emailErr, staffId }, 'Failed to re-queue staff invitation email');
  }

  return {
    success: true,
    ...(process.env.NODE_ENV !== 'production' ? { inviteToken: rawToken, inviteUrl } : {}),
  };
}

export async function revokeStaffInvite(
  actor: string | StaffActorContext,
  staffId: string,
  requestId?: string,
) {
  const actorCtx = await resolveActorContext(actor);
  const staff = await platformRepo.findStaffById(staffId);
  if (!staff) throw AppError.notFound('Staff member not found');

  if (staff.status !== 'INVITED') {
    throw AppError.badRequest('Can only revoke invitations for staff members in INVITED status');
  }

  await platformRepo.updateStaff(staffId, {
    status: 'DEACTIVATED',
    inviteTokenHash: null,
    inviteExpiresAt: null,
  });

  await platformRepo.logPlatformAction({
    actorStaffId: actorCtx.id,
    action: 'platform_staff.invite_revoked',
    targetType: 'staff',
    targetId: staffId,
    metadata: { email: staff.email },
    requestId,
  });

  return { success: true };
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
      (newRoleKey === PLATFORM_ROLES.SUPER_ADMIN ||
        currentRoleKey === PLATFORM_ROLES.SUPER_ADMIN) &&
      actorCtx.roleKey !== PLATFORM_ROLES.SUPER_ADMIN
    ) {
      throw AppError.forbidden('Only Super Admins can assign or remove the SUPER_ADMIN role');
    }

    // Last Super Admin invariant: ensure at least one active SUPER_ADMIN remains
    if (
      currentRoleKey === PLATFORM_ROLES.SUPER_ADMIN &&
      newRoleKey !== PLATFORM_ROLES.SUPER_ADMIN
    ) {
      const activeSuperAdminCount = await platformRepo.countActiveSuperAdmins();
      if (activeSuperAdminCount <= 1) {
        throw AppError.badRequest('Cannot demote the last remaining active Super Admin');
      }
    }
  }

  if (data.status) {
    const hasDisablePerm =
      actorCtx.roleKey === PLATFORM_ROLES.SUPER_ADMIN ||
      actorCtx.permissions?.includes('*') ||
      actorCtx.permissions?.includes(PLATFORM_PERMISSIONS.STAFF_DISABLE);

    if (!hasDisablePerm) {
      throw AppError.forbidden(
        `Status changes require ${PLATFORM_PERMISSIONS.STAFF_DISABLE} permission`,
      );
    }

    if (data.status === 'SUSPENDED' || data.status === 'DEACTIVATED') {
      if (staff.roleKey === PLATFORM_ROLES.SUPER_ADMIN) {
        if (actorCtx.roleKey !== PLATFORM_ROLES.SUPER_ADMIN) {
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

  if (staff.roleKey === PLATFORM_ROLES.SUPER_ADMIN) {
    if (actorCtx.roleKey !== PLATFORM_ROLES.SUPER_ADMIN) {
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

export async function updateStaffProfile(
  staffId: string,
  data: UpdatePlatformProfileDto,
  requestId?: string,
) {
  const staff = await platformRepo.findStaffById(staffId);
  if (!staff) throw AppError.notFound('Platform staff member not found');

  const updated = await platformRepo.updateStaff(staffId, data);
  if (!updated) throw AppError.notFound('Platform staff member not found');

  await platformRepo.logPlatformAction({
    actorStaffId: staffId,
    action: 'platform_staff.profile_updated',
    targetType: 'staff',
    targetId: staffId,
    metadata: { changedFields: Object.keys(data) },
    requestId,
  });

  return updated;
}

export async function changeStaffPassword(
  staffId: string,
  data: ChangePlatformPasswordDto,
  requestId?: string,
) {
  const staff = await platformRepo.findStaffById(staffId);
  if (!staff) throw AppError.notFound('Platform staff member not found');

  const staffWithHash = await platformRepo.findStaffByEmail(staff.email);
  if (!staffWithHash) throw AppError.notFound('Platform staff member not found');

  const valid = await bcrypt.compare(data.currentPassword, staffWithHash.passwordHash);
  if (!valid) {
    throw AppError.badRequest('Current password is incorrect');
  }

  const isSame = await bcrypt.compare(data.newPassword, staffWithHash.passwordHash);
  if (isSame) {
    throw AppError.badRequest('New password must be different from current password');
  }

  const passwordHash = await bcrypt.hash(data.newPassword, 12);
  await platformRepo.updateStaff(staffId, { passwordHash });

  await platformRepo.logPlatformAction({
    actorStaffId: staffId,
    action: 'platform_staff.password_changed',
    targetType: 'staff',
    targetId: staffId,
    requestId,
  });

  return { message: 'Password changed successfully' };
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

export async function seedPlatformDefaults(): Promise<void> {
  // 1. Ensure all canonical permissions exist in database (single-colon format)
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
      .onConflictDoUpdate({
        target: platformPermissions.key,
        set: {
          name: perm.name,
          description: perm.description,
          resource: perm.resource,
          action: perm.action,
        },
      });
  }

  // 2. Ensure system platform roles exist and have current permissions
  for (const roleDef of Object.values(SYSTEM_PLATFORM_ROLES)) {
    const existing = await platformRepo.findRoleByKey(roleDef.key);
    const perms = await platformRepo.findPermissionsByKeys(roleDef.permissions as string[]);
    const permIds = perms.map((p) => p.id);

    if (!existing) {
      await platformRepo.createRole(
        {
          key: roleDef.key,
          name: roleDef.name,
          description: roleDef.description,
          isSystem: true,
          isActive: true,
        },
        permIds,
      );
    } else {
      await platformRepo.updateRole(existing.id, { updatedAt: new Date() }, permIds);
    }
  }

  // 3. Clean up any obsolete double-colon permissions in database
  await db.execute(sql`
    DELETE FROM "PlatformRolePermission"
    WHERE "permissionId" IN (
      SELECT id FROM "PlatformPermission" WHERE "key" LIKE '%::%'
    );
    DELETE FROM "PlatformPermission" WHERE "key" LIKE '%::%';
  `);
}

// ==========================================
// 6. Platform Tenant Oversight & Provisioning
// ==========================================
