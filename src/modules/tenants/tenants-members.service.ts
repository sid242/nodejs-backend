import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

import { db } from '@/config/db';
import { env } from '@/config/env';
import { userGroupMembers, type PublicUser, type TenantMember } from '@/db/schema/index';
import { AppError } from '@/lib/errors';
import * as auditRepo from '@/modules/audit/audit.repository';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import * as authRepo from '@/modules/auth/auth.repository';
import {
  createMagicLinkToken,
  issueTokens,
  revokeAllUserTokens,
  verifyAndConsumeMagicLinkToken,
} from '@/modules/auth/tokens';
import * as billingService from '@/modules/billing/billing.service';
import * as filesRepo from '@/modules/files/files.repository';
import { rbacRepo } from '@/modules/rbac/rbac.repository';
import * as rbacService from '@/modules/rbac/rbac.service';
import { emailQueue } from '@/queues/index';

import { buildTenantUrl } from './tenant-url.service';
import {
  addMemberDto,
  type AddMemberDto,
  type BulkInviteItemDto,
  type ExportMembersQueryDto,
  type ListMembersQueryDto,
  type OffboardMemberDto,
  type UpdateMemberDto,
} from './tenants.dto';
import { tenantsRepo } from './tenants.repository';

export async function listMembers(tenantId: string, filters?: ListMembersQueryDto) {
  if (filters && Object.keys(filters).length > 0) {
    return tenantsRepo.findTenantMembersPaginated(tenantId, filters);
  }
  return tenantsRepo.findTenantMembers(tenantId);
}

export async function exportMembers(
  tenantId: string,
  options?: ExportMembersQueryDto,
  actorUserId?: string,
) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const members = await tenantsRepo.findTenantMembers(tenantId);
  const filtered =
    options?.status && options.status !== 'ALL'
      ? members.filter((m) => m.status === options.status)
      : members;

  if (actorUserId) {
    await auditRepo.createAuditLog({
      tenantId,
      action: 'MEMBER.EXPORTED',
      entityType: 'TenantMember',
      entityId: tenantId,
      actorType: 'USER',
      actorUserId,
      metadata: {
        count: filtered.length,
        format: options?.format ?? 'csv',
      },
    });
  }

  if (options?.format === 'json') {
    return { format: 'json' as const, data: filtered, filename: `members-${tenant.slug}.json` };
  }

  const headers = [
    'Member ID',
    'First Name',
    'Last Name',
    'Email',
    'Role',
    'Status',
    'Member Code',
    'Job Title',
    'Department',
    'Location',
    'Employment Type',
    'Work Email',
    'Joined Date',
  ];

  const escapeCsv = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = filtered.map((m) => [
    escapeCsv(m.id),
    escapeCsv(m.firstName),
    escapeCsv(m.lastName),
    escapeCsv(m.email),
    escapeCsv(m.role),
    escapeCsv(m.status),
    escapeCsv(m.memberCode ?? ''),
    escapeCsv(m.jobTitle ?? ''),
    escapeCsv(m.department ?? ''),
    escapeCsv(m.location ?? ''),
    escapeCsv(m.employmentType ?? ''),
    escapeCsv(m.workEmail ?? ''),
    escapeCsv(m.joinedAt ? new Date(m.joinedAt).toISOString() : ''),
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const filename = `members-${tenant.slug}-${new Date().toISOString().split('T')[0]}.csv`;

  return { format: 'csv' as const, data: csvContent, filename };
}

export async function getMemberDetail(tenantId: string, memberId: string) {
  const member = await tenantsRepo.findTenantMemberDetail(tenantId, memberId);
  if (!member) throw AppError.notFound('Tenant member not found');
  return member;
}

export async function updateMemberDetails(
  tenantId: string,
  memberId: string,
  data: UpdateMemberDto,
  operatorUserId?: string,
) {
  const member = await tenantsRepo.findTenantMemberById(memberId);
  if (!member || member.tenantId !== tenantId) {
    throw AppError.notFound('Member not found in this tenant');
  }

  const updated = await tenantsRepo.updateTenantMemberMetadata(memberId, {
    ...(data.phone !== undefined ? { phone: data.phone } : {}),
    ...(data.memberCode !== undefined ? { memberCode: data.memberCode } : {}),
    ...(data.jobTitle !== undefined ? { jobTitle: data.jobTitle } : {}),
    ...(data.department !== undefined ? { department: data.department } : {}),
    ...(data.managerMemberId !== undefined ? { managerMemberId: data.managerMemberId } : {}),
    ...(data.location !== undefined ? { location: data.location } : {}),
    ...(data.employmentType !== undefined ? { employmentType: data.employmentType } : {}),
    ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
    ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
    ...(data.workEmail !== undefined ? { workEmail: data.workEmail } : {}),
    ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
  });

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'MEMBER.UPDATED',
    entityType: 'TenantMember',
    entityId: memberId,
    metadata: { changes: data },
  });

  return updated;
}

export async function addMemberToTenant(
  tenantId: string,
  operatorUserId: string,
  payload: string | AddMemberDto,
  explicitRoleName?: string,
  sendInviteEmail = true,
): Promise<{
  member: TenantMember;
  role: string;
  inviteToken?: string;
  inviteUrl?: string;
  message?: string;
}> {
  const dto: AddMemberDto = addMemberDto.parse(
    typeof payload === 'string'
      ? { email: payload, role: explicitRoleName || rbacService.SYSTEM_ROLES.MEMBER }
      : payload,
  );

  // Find target role (either custom tenant role or system role)
  const roleId = dto.roleId;
  let matchedRole;

  if (roleId) {
    matchedRole = await rbacRepo.findRoleById(roleId);
  } else {
    const roleName = dto.role || explicitRoleName || rbacService.SYSTEM_ROLES.MEMBER;
    const availableRoles = await rbacRepo.findRolesByTenant(tenantId);
    matchedRole = availableRoles.find((r) => r.name.toLowerCase() === roleName.toLowerCase());
  }

  if (
    !matchedRole ||
    (matchedRole.tenantId && matchedRole.tenantId !== tenantId) ||
    !matchedRole.isActive
  ) {
    throw AppError.badRequest('Invalid workspace role specified for member');
  }
  const roleCode = (matchedRole.code ?? matchedRole.name).toUpperCase();
  if (roleCode === rbacService.SYSTEM_ROLES.OWNER) {
    throw AppError.forbidden('Assign ownership through the workspace ownership transfer');
  }
  const isBaseRole =
    matchedRole.tenantId === null &&
    (roleCode === rbacService.SYSTEM_ROLES.MEMBER || roleCode === rbacService.SYSTEM_ROLES.VIEWER);
  if (!isBaseRole) {
    const operator = await rbacService.resolveUserPermissions(tenantId, operatorUserId);
    if (
      !operator.permissions.includes('*') &&
      !operator.permissions.includes('roles:assign') &&
      !operator.roles.includes(rbacService.SYSTEM_ROLES.OWNER)
    ) {
      throw AppError.forbidden('Permission to assign this workspace role is required');
    }
  }

  const normalizedEmail = dto.email.toLowerCase().trim();
  let targetUser = await authRepo.findByEmail(normalizedEmail);
  let isNewUser = false;

  // 1. Immediately reject if target user is already an active member of this tenant
  if (targetUser) {
    const existing = await tenantsRepo.findTenantMember(tenantId, targetUser.id);
    if (existing && existing.status === 'ACTIVE') {
      throw AppError.conflict('User is already a member of this tenant');
    }
  }

  // 2. Enforce SaaS Plan Seat Limits before provisioning new accounts or invites
  await billingService.enforceLimit(tenantId, 'maxMembers');

  if (!targetUser) {
    // Automatically provision account in PENDING_VERIFICATION so the invitee can join seamlessly
    const dummyHash = await bcrypt.hash(randomUUID(), 12);
    const defaultNamePart = normalizedEmail.split('@')[0] || 'Member';
    const firstName =
      dto.firstName?.trim() || defaultNamePart.charAt(0).toUpperCase() + defaultNamePart.slice(1);
    const lastName = dto.lastName?.trim() || 'Member';

    const created = await authRepo.createUser({
      email: normalizedEmail,
      firstName,
      lastName,
      passwordHash: dummyHash,
    });
    targetUser = await authRepo.findById(created.id);
    isNewUser = true;
  }

  if (!targetUser) {
    throw AppError.internal('Failed to provision user for invitation');
  }

  const existing = await tenantsRepo.findTenantMember(tenantId, targetUser.id);

  let member: TenantMember;
  if (existing) {
    const updated = await tenantsRepo.updateTenantMemberMetadata(existing.id, {
      status: 'INVITED',
      memberCode: dto.memberCode?.trim() ?? existing.memberCode,
      phone: dto.phone?.trim() ?? existing.phone,
      jobTitle: dto.jobTitle?.trim() ?? existing.jobTitle,
      department: dto.department?.trim() ?? existing.department,
      invitedAt: new Date(),
      deletedAt: null,
    });
    member = updated ?? existing;
  } else {
    member = await tenantsRepo.addTenantMember({
      tenantId,
      userId: targetUser.id,
      status: 'INVITED',
      memberCode: dto.memberCode?.trim() ?? null,
      phone: dto.phone?.trim() ?? null,
      jobTitle: dto.jobTitle?.trim() ?? null,
      department: dto.department?.trim() ?? null,
      invitedAt: new Date(),
    });
  }

  await rbacRepo.assignRoleToMember(member.id, matchedRole.id);

  // If user groups were provided, associate them
  if (dto.groupIds && dto.groupIds.length > 0) {
    for (const groupId of dto.groupIds) {
      await db
        .insert(userGroupMembers)
        .values({
          groupId,
          userId: targetUser.id,
        })
        .onConflictDoNothing();
    }
  }

  await rbacService.invalidateRbacCache(tenantId, targetUser.id);

  const expirationHours = dto.expiresInHours ?? 48;
  const inviteToken = await createMagicLinkToken(targetUser.id, expirationHours * 3600, tenantId);
  const tenant = await tenantsRepo.findTenantById(tenantId);

  const inviteUrl = await buildTenantUrl(
    tenantId,
    `/accept-invite?token=${inviteToken}&tenant=${tenantId}`,
  );

  if (sendInviteEmail) {
    await emailQueue.add(
      'tenant-invite',
      {
        to: targetUser.email,
        name: [targetUser.firstName, targetUser.lastName].filter(Boolean).join(' ') || 'Member',
        tenantName: tenant?.name ?? 'Workspace',
        roleName: matchedRole.name,
        token: inviteToken,
        inviteUrl,
        tenantId,
        message: dto.message,
      },
      { jobId: `invite-${tenantId}-${targetUser.id}-${Date.now()}` },
    );
  }

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: isNewUser ? 'MEMBER.INVITED' : 'MEMBER.ADDED',
    entityType: 'TenantMember',
    entityId: member.id,
    metadata: { addedUserEmail: normalizedEmail, role: matchedRole.name, isNewUser },
  });

  const exposeDev = Boolean(env.EXPOSE_DEV_TOKENS) && process.env.NODE_ENV !== 'production';

  return {
    member,
    role: matchedRole.name,
    inviteUrl: exposeDev ? inviteUrl : undefined,
    message: sendInviteEmail
      ? `Invitation successfully sent to ${normalizedEmail}`
      : 'Invitation prepared',
  };
}

export async function acceptTenantInvitation(
  token: string,
  expectedTenantId?: string,
): Promise<{
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  activeTenantId?: string;
}> {
  const { userId, target: boundTenantId } = await verifyAndConsumeMagicLinkToken(token);

  if (!boundTenantId) {
    throw AppError.badRequest('Invitation token is not bound to a workspace');
  }

  // If the caller provided expectedTenantId, ensure consistency with the token's bound workspace
  if (expectedTenantId && boundTenantId !== expectedTenantId) {
    throw AppError.forbidden('Invitation token does not belong to the requested workspace');
  }

  const targetTenantId = boundTenantId;

  const userRecord = await authRepo.findById(userId);
  if (!userRecord || userRecord.deletedAt) {
    throw AppError.unauthorized('User not found');
  }

  if (userRecord.status === 'SUSPENDED' || userRecord.status === 'DEACTIVATED') {
    throw AppError.forbidden(`Account is ${userRecord.status.toLowerCase()}`);
  }

  let finalUser: PublicUser | null = null;
  // Activate user if pending verification
  if (!userRecord.emailVerifiedAt || userRecord.status === 'PENDING_VERIFICATION') {
    finalUser = await authRepo.markEmailVerified(userRecord.id);
  }

  if (!finalUser) {
    finalUser = await authRepo.findPublicUserById(userRecord.id);
  }

  if (!finalUser) {
    throw AppError.internal('Failed to retrieve user status');
  }

  // Activate ONLY the target tenant membership for this user (never activate memberships across other tenants)
  const memberships = await tenantsRepo.findMembershipsByUserId(userId);
  let activeTenantId: string | undefined = undefined;
  let targetMembershipFound = false;

  for (const m of memberships) {
    if (m.tenantId === targetTenantId) {
      targetMembershipFound = true;
      if (m.status === 'INVITED') {
        await tenantsRepo.updateTenantMemberStatus(m.id, 'ACTIVE');
        await rbacService.invalidateRbacCache(m.tenantId, userId);
      }
      activeTenantId = m.tenantId;
    }
  }

  if (!targetMembershipFound) {
    throw AppError.notFound('Invitation membership not found for this workspace');
  }

  const tokens = await issueTokens(finalUser);

  return { user: finalUser, ...tokens, activeTenantId };
}

export async function removeMemberFromTenant(
  tenantId: string,
  operatorUserId: string,
  memberId: string,
): Promise<void> {
  const member = await tenantsRepo.findTenantMemberById(memberId);
  if (!member || member.tenantId !== tenantId) {
    throw AppError.notFound('Member not found in this tenant');
  }

  if (member.userId === operatorUserId) {
    throw AppError.badRequest(
      'You cannot remove yourself from the tenant. Transfer ownership first.',
    );
  }

  // Edge Case safeguard: Cannot remove member if they are the last remaining OWNER
  const existingRoles = await rbacRepo.getMemberRoles(member.id);
  const isOwner = existingRoles.some((r) => r.name.toLowerCase() === 'owner');
  if (isOwner) {
    const ownerCount = await rbacRepo.countTenantOwners(tenantId);
    if (ownerCount <= 1) {
      throw AppError.badRequest(
        'Cannot remove the last remaining Owner of this organization. Promote another member to Owner first.',
      );
    }

    // Only an Owner can remove another Owner
    const operatorMember = await tenantsRepo.findTenantMember(tenantId, operatorUserId);
    if (operatorMember) {
      const operatorRoles = await rbacRepo.getMemberRoles(operatorMember.id);
      const operatorIsOwner = operatorRoles.some((r) => r.name.toLowerCase() === 'owner');
      if (!operatorIsOwner) {
        throw AppError.forbidden('Only an Owner can remove another Owner');
      }
    }
  }

  await tenantsRepo.softDeleteTenantMember(tenantId, memberId);
  await rbacService.invalidateRbacCache(tenantId, member.userId);
  await revokeAllUserTokens(member.userId);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'MEMBER.REMOVED',
    entityType: 'TenantMember',
    entityId: memberId,
    metadata: { removedUserId: member.userId },
  });
}

export async function updateMemberRole(
  tenantId: string,
  operatorUserId: string,
  memberId: string,
  newRoleName: string,
): Promise<{ message: string; role: string }> {
  const member = await tenantsRepo.findTenantMemberById(memberId);
  if (!member || member.tenantId !== tenantId) {
    throw AppError.notFound('Member not found in this tenant');
  }

  const existingRoles = await rbacRepo.getMemberRoles(member.id);
  const wasOwner = existingRoles.some((r) => r.name.toLowerCase() === 'owner');
  const willBeOwner = newRoleName.toLowerCase() === 'owner';

  // Edge Case 1: Last Owner Invariant (Cannot demote the only remaining Owner)
  if (wasOwner && !willBeOwner) {
    const ownerCount = await rbacRepo.countTenantOwners(tenantId);
    if (ownerCount <= 1) {
      throw AppError.badRequest(
        'Cannot demote the last remaining Owner of this organization. Promote another member to Owner first.',
      );
    }
  }

  // Edge Case 2: Privilege Escalation Prevention (Only an Owner can grant or revoke OWNER role)
  const operatorMember = await tenantsRepo.findTenantMember(tenantId, operatorUserId);
  if (operatorMember) {
    const operatorRoles = await rbacRepo.getMemberRoles(operatorMember.id);
    const operatorIsOwner = operatorRoles.some((r) => r.name.toLowerCase() === 'owner');

    if (!operatorIsOwner && (willBeOwner || wasOwner)) {
      throw AppError.forbidden('Only an Owner can grant or revoke the Owner role');
    }
  }

  const availableRoles = await rbacRepo.findRolesByTenant(tenantId);
  const matchedRole = availableRoles.find(
    (r) => r.name.toLowerCase() === newRoleName.toLowerCase(),
  );
  if (!matchedRole) {
    throw AppError.badRequest(`Role "${newRoleName}" is not valid for this tenant`);
  }

  for (const r of existingRoles) {
    await rbacRepo.removeRoleFromMember(member.id, r.id);
  }
  await rbacRepo.assignRoleToMember(member.id, matchedRole.id);
  await rbacService.invalidateRbacCache(tenantId, member.userId);

  // Invalidate target user's active sessions so they must re-authenticate with updated claims
  await revokeAllUserTokens(member.userId);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'MEMBER.ROLE_CHANGED',
    entityType: 'TenantMember',
    entityId: member.id,
    metadata: {
      previousRoles: existingRoles.map((r) => r.name),
      newRole: matchedRole.name,
    },
  });

  return { message: 'Member role updated successfully', role: matchedRole.name };
}

export async function updateTenantMemberStatus(
  tenantId: string,
  operatorUserId: string,
  memberId: string,
  status: 'ACTIVE' | 'SUSPENDED',
): Promise<{ message: string; member: TenantMember }> {
  const member = await tenantsRepo.findTenantMemberById(memberId);
  if (!member || member.tenantId !== tenantId) {
    throw AppError.notFound('Member not found in this tenant');
  }

  if (member.userId === operatorUserId && status === 'SUSPENDED') {
    throw AppError.badRequest('You cannot suspend your own membership');
  }

  if (status === 'SUSPENDED') {
    const existingRoles = await rbacRepo.getMemberRoles(member.id);
    const isOwner = existingRoles.some((r) => r.name.toLowerCase() === 'owner');
    if (isOwner) {
      const ownerCount = await rbacRepo.countTenantOwners(tenantId);
      if (ownerCount <= 1) {
        throw AppError.badRequest('Cannot suspend the last remaining Owner of this organization.');
      }
    }
  }

  const updated = await tenantsRepo.updateTenantMemberStatus(memberId, status);
  if (!updated) {
    throw AppError.internal('Failed to update member status');
  }

  if (status === 'SUSPENDED') {
    await revokeAllUserTokens(member.userId);
  }

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: status === 'SUSPENDED' ? 'MEMBER.SUSPENDED' : 'MEMBER.REACTIVATED',
    entityType: 'TenantMember',
    entityId: memberId,
    metadata: { targetUserId: member.userId, status },
  });

  return {
    message: `Member successfully ${status.toLowerCase()}`,
    member: updated,
  };
}

export async function offboardTenantMember(
  tenantId: string,
  operatorUserId: string,
  memberId: string,
  dto: OffboardMemberDto,
): Promise<{
  message: string;
  member: TenantMember;
  reassignedFilesCount: number;
}> {
  const member = await tenantsRepo.findTenantMemberById(memberId);
  if (!member || member.tenantId !== tenantId) {
    throw AppError.notFound('Member not found in this tenant');
  }

  if (member.userId === operatorUserId) {
    throw AppError.badRequest('You cannot offboard yourself from the tenant');
  }

  // Last Owner guard: Cannot offboard if member is the last remaining OWNER
  const existingRoles = await rbacRepo.getMemberRoles(member.id);
  const isOwner = existingRoles.some((r) => r.name.toLowerCase() === 'owner');
  if (isOwner) {
    const ownerCount = await rbacRepo.countTenantOwners(tenantId);
    if (ownerCount <= 1) {
      throw AppError.badRequest(
        'Cannot offboard the last remaining Owner of this organization. Transfer ownership first.',
      );
    }
  }

  // Find operator member to track who offboarded
  const operatorMember = await tenantsRepo.findTenantMember(tenantId, operatorUserId);

  // Validate reassignment target if provided
  let reassignedFilesCount = 0;
  if (dto.reassignToMemberId) {
    if (dto.reassignToMemberId === memberId) {
      throw AppError.badRequest('Cannot reassign resources to the member being offboarded');
    }
    const targetMember = await tenantsRepo.findTenantMemberById(dto.reassignToMemberId);
    if (!targetMember || targetMember.tenantId !== tenantId) {
      throw AppError.badRequest('Reassignment target member not found in this tenant');
    }
    if (targetMember.status !== 'ACTIVE') {
      throw AppError.badRequest('Reassignment target member must be active');
    }

    reassignedFilesCount = await filesRepo.reassignOwnerFiles(
      tenantId,
      member.userId,
      targetMember.userId,
    );
  }

  // Update member status to SUSPENDED with offboarding metadata
  const updated = await tenantsRepo.updateTenantMemberMetadata(memberId, {
    status: 'SUSPENDED',
    offboardedAt: new Date(),
    offboardedByMemberId: operatorMember?.id ?? null,
    reassignedToMemberId: dto.reassignToMemberId ?? null,
  });

  if (!updated) {
    throw AppError.internal('Failed to update member offboarding status');
  }

  // Invalidate sessions and RBAC cache
  await rbacService.invalidateRbacCache(tenantId, member.userId);
  await revokeAllUserTokens(member.userId);

  // Audit event
  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'MEMBER.OFFBOARDED',
    entityType: 'TenantMember',
    entityId: memberId,
    metadata: {
      targetUserId: member.userId,
      reassignedToMemberId: dto.reassignToMemberId,
      reassignedFilesCount,
      reason: dto.reason,
    },
  });

  return {
    message: 'Member successfully offboarded',
    member: updated,
    reassignedFilesCount,
  };
}

export async function bulkInviteMembers(
  tenantId: string,
  operatorUserId: string,
  invites: Array<BulkInviteItemDto | { email: string; role?: string }>,
): Promise<{
  successful: Array<{ email: string; role: string; inviteUrl?: string }>;
  failed: Array<{ email: string; reason: string }>;
}> {
  const overview = await billingService.getTenantBillingOverview(tenantId);
  const maxMembers = overview.limits.maxMembers;
  if (maxMembers !== null) {
    const currentMembers = overview.usage.members;
    const remainingSeats = Math.max(0, maxMembers - currentMembers);
    if (remainingSeats < invites.length) {
      throw AppError.forbidden(
        `Cannot invite ${invites.length} members. Only ${remainingSeats} seat(s) remaining on your current plan. Please upgrade your subscription.`,
      );
    }
  }

  const successful: Array<{ email: string; role: string; inviteUrl?: string }> = [];
  const failed: Array<{ email: string; reason: string }> = [];

  for (const inv of invites) {
    try {
      const result = await addMemberToTenant(tenantId, operatorUserId, inv as AddMemberDto);
      successful.push({
        email: inv.email,
        role: result.role,
        inviteUrl: result.inviteUrl,
      });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'Failed to send invite';
      failed.push({ email: inv.email, reason });
    }
  }

  return { successful, failed };
}

export async function transferTenantOwnership(
  tenantId: string,
  operatorUserId: string,
  newOwnerMemberId: string,
  newRoleForFormerOwner = 'ADMIN',
): Promise<{ message: string; newOwnerId: string; formerOwnerRole: string }> {
  // 1. Verify target member exists in this tenant
  const targetMember = await tenantsRepo.findTenantMemberById(newOwnerMemberId);
  if (!targetMember || targetMember.tenantId !== tenantId) {
    throw AppError.notFound('Target member not found in this tenant');
  }

  if (targetMember.status !== 'ACTIVE') {
    throw AppError.badRequest('Ownership can only be transferred to an ACTIVE member');
  }

  if (targetMember.userId === operatorUserId) {
    throw AppError.badRequest('You are already the owner of this workspace');
  }

  // 2. Verify operator is currently an OWNER
  const operatorMember = await tenantsRepo.findTenantMember(tenantId, operatorUserId);
  if (!operatorMember) {
    throw AppError.forbidden('You are not a member of this tenant');
  }

  const operatorRoles = await rbacRepo.getMemberRoles(operatorMember.id);
  const operatorIsOwner = operatorRoles.some((r) => r.name.toLowerCase() === 'owner');
  if (!operatorIsOwner) {
    throw AppError.forbidden('Only an existing Owner can transfer workspace ownership');
  }

  // 3. Resolve OWNER role and demotion role (e.g. ADMIN)
  const availableRoles = await rbacRepo.findRolesByTenant(tenantId);
  const ownerRole = availableRoles.find((r) => r.name.toLowerCase() === 'owner');
  const demotedRole = availableRoles.find(
    (r) => r.name.toLowerCase() === newRoleForFormerOwner.toLowerCase(),
  );

  if (!ownerRole) {
    throw AppError.internal('Owner role definition not found');
  }
  if (!demotedRole) {
    throw AppError.badRequest(`Role "${newRoleForFormerOwner}" is not valid for this tenant`);
  }

  // 4. Atomic role updates
  // Assign OWNER role to target member
  const targetRoles = await rbacRepo.getMemberRoles(targetMember.id);
  for (const r of targetRoles) {
    await rbacRepo.removeRoleFromMember(targetMember.id, r.id);
  }
  await rbacRepo.assignRoleToMember(targetMember.id, ownerRole.id);

  // Demote former owner
  for (const r of operatorRoles) {
    await rbacRepo.removeRoleFromMember(operatorMember.id, r.id);
  }
  await rbacRepo.assignRoleToMember(operatorMember.id, demotedRole.id);

  // Invalidate caches and tokens so sessions immediately re-evaluate permissions
  await rbacService.invalidateRbacCache(tenantId, targetMember.userId);
  await rbacService.invalidateRbacCache(tenantId, operatorUserId);
  await revokeAllUserTokens(targetMember.userId);
  await revokeAllUserTokens(operatorUserId);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'TENANT.OWNERSHIP_TRANSFERRED',
    entityType: 'Tenant',
    entityId: tenantId,
    metadata: {
      formerOwnerId: operatorUserId,
      newOwnerId: targetMember.userId,
      newOwnerMemberId,
      newRoleForFormerOwner: demotedRole.name,
    },
  });

  return {
    message: 'Workspace ownership successfully transferred',
    newOwnerId: targetMember.userId,
    formerOwnerRole: demotedRole.name,
  };
}

// -----------------------------------------------------------------------------
// Org Chart & Bulk Member Import
// -----------------------------------------------------------------------------

export interface OrgChartNode {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  department: string | null;
  jobTitle: string | null;
  managerMemberId: string | null;
  status: string;
  directReportsCount: number;
  directReports: OrgChartNode[];
}

export async function getTenantOrgChart(tenantId: string): Promise<{
  roots: OrgChartNode[];
  totalMembers: number;
  departments: string[];
}> {
  const paginated = await tenantsRepo.findTenantMembersPaginated(tenantId, {
    limit: 1000,
    page: 1,
    status: 'ACTIVE',
    sortBy: 'joinedAt',
    sortOrder: 'asc',
  });

  const activeMembers = paginated.items;
  const memberMap = new Map<string, OrgChartNode>();
  const departmentsSet = new Set<string>();

  for (const m of activeMembers) {
    if (m.department) departmentsSet.add(m.department);
    memberMap.set(m.id, {
      id: m.id,
      userId: m.userId,
      name: m.name || m.email,
      email: m.email,
      avatarUrl: m.avatarUrl ?? null,
      role: m.role || 'MEMBER',
      department: m.department ?? null,
      jobTitle: m.jobTitle ?? null,
      managerMemberId:
        (m as unknown as { managerMemberId?: string | null })?.managerMemberId ?? null,
      status: m.status,
      directReportsCount: 0,
      directReports: [],
    });
  }

  const roots: OrgChartNode[] = [];
  for (const node of memberMap.values()) {
    if (node.managerMemberId && memberMap.has(node.managerMemberId)) {
      const parent = memberMap.get(node.managerMemberId)!;
      parent.directReports.push(node);
      parent.directReportsCount += 1;
    } else {
      roots.push(node);
    }
  }

  return {
    roots,
    totalMembers: activeMembers.length,
    departments: Array.from(departmentsSet).sort(),
  };
}

export async function validateMemberImport(
  tenantId: string,
  rows: Array<{
    email: string;
    role?: string;
    firstName?: string;
    lastName?: string;
    jobTitle?: string;
    department?: string;
    phone?: string;
    managerEmail?: string | null;
  }>,
) {
  const overview = await billingService.getTenantBillingOverview(tenantId);
  const maxMembers = overview.limits.maxMembers;
  const currentMembers = overview.usage.members;
  const quotaAvailable = maxMembers !== null ? Math.max(0, maxMembers - currentMembers) : 999999;

  const paginated = await tenantsRepo.findTenantMembersPaginated(tenantId, {
    limit: 2000,
    page: 1,
    sortBy: 'joinedAt',
    sortOrder: 'asc',
  });
  const existingEmailSet = new Set(
    paginated.items.map((m) => m.email?.toLowerCase()).filter(Boolean),
  );

  const allowedRoles = new Set(
    (await rbacRepo.findRolesByTenant(tenantId))
      .filter(
        (role) =>
          role.isActive &&
          (role.code ?? role.name).toUpperCase() !== rbacService.SYSTEM_ROLES.OWNER,
      )
      .map((role) => role.name.toLowerCase()),
  );
  const seenEmails = new Set<string>();
  const validationResults = rows.map((r, idx) => {
    const emailNorm = r.email.toLowerCase().trim();
    let status: 'VALID' | 'ERROR' | 'DUPLICATE' = 'VALID';
    let error: string | undefined;

    if (!allowedRoles.has((r.role || 'MEMBER').toLowerCase())) {
      status = 'ERROR';
      error = 'Select an assignable workspace role';
    } else if (existingEmailSet.has(emailNorm)) {
      status = 'DUPLICATE';
      error = 'Already an existing member in this workspace';
    } else if (seenEmails.has(emailNorm)) {
      status = 'DUPLICATE';
      error = 'Duplicate email within the import file';
    } else {
      seenEmails.add(emailNorm);
    }

    return {
      row: idx + 1,
      email: r.email,
      role: r.role || 'MEMBER',
      firstName: r.firstName,
      lastName: r.lastName,
      jobTitle: r.jobTitle,
      department: r.department,
      phone: r.phone,
      managerEmail: r.managerEmail,
      status,
      error,
    };
  });

  const validCount = validationResults.filter((r) => r.status === 'VALID').length;
  const errorCount = validationResults.length - validCount;
  const hasQuota = validCount <= quotaAvailable;

  return {
    valid: errorCount === 0 && hasQuota,
    quotaAvailable,
    totalRows: rows.length,
    validCount,
    errorCount,
    exceedsQuota: !hasQuota,
    rows: validationResults,
  };
}

export async function executeMemberImport(
  tenantId: string,
  operatorUserId: string,
  rows: Array<{
    email: string;
    role?: string;
    firstName?: string;
    lastName?: string;
    jobTitle?: string;
    department?: string;
    phone?: string;
    managerEmail?: string | null;
  }>,
  sendInviteEmails = true,
  onProgress?: (processed: number, total: number) => Promise<void>,
) {
  const validation = await validateMemberImport(tenantId, rows);
  if (validation.exceedsQuota) {
    throw AppError.forbidden(
      `Import exceeds seat quota. Only ${validation.quotaAvailable} seat(s) available.`,
    );
  }

  const validRows = validation.rows.filter((r) => r.status === 'VALID');
  const results: Array<{ email: string; status: 'IMPORTED' | 'FAILED'; error?: string }> = [];

  for (const r of validRows) {
    try {
      await addMemberToTenant(
        tenantId,
        operatorUserId,
        {
          email: r.email,
          role: r.role,
          expiresInHours: 48,
          firstName: r.firstName,
          lastName: r.lastName,
          jobTitle: r.jobTitle,
          department: r.department,
          phone: r.phone,
        },
        undefined,
        sendInviteEmails,
      );
      results.push({ email: r.email, status: 'IMPORTED' });
    } catch (err: unknown) {
      const msg = err instanceof AppError ? err.message : 'Import failed';
      results.push({ email: r.email, status: 'FAILED', error: msg });
    }
    await onProgress?.(results.length, validRows.length);
  }

  const importedCount = results.filter((r) => r.status === 'IMPORTED').length;

  await auditRepo.createAuditLog({
    tenantId,
    action: 'MEMBERS.BULK_IMPORTED',
    entityType: 'TenantMember',
    actorType: 'USER',
    actorUserId: operatorUserId,
    metadata: {
      totalSubmitted: rows.length,
      importedCount,
      failedCount: results.length - importedCount,
    },
  });

  return {
    totalSubmitted: rows.length,
    importedCount,
    failedCount: results.length - importedCount,
    results,
  };
}
