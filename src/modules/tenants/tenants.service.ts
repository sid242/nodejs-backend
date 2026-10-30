import { randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';

import { env } from '@/config/env';
import type {
  PublicTenant,
  PublicTenantBranding,
  PublicTenantEmailConfig,
  PublicUser,
  Tenant,
  TenantMember,
} from '@/db/schema/index';
import { cache } from '@/lib/cache';
import { addCorsCustomDomain, removeCorsCustomDomain } from '@/lib/cors';
import { decrypt, encrypt } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { invalidateTenantEmailCache, verifySmtpConnection } from '@/lib/mailer';
import { createUploadPost } from '@/lib/s3';
import { safeFilename } from '@/lib/utils';
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
import { rbacRepo } from '@/modules/rbac/rbac.repository';
import * as rbacService from '@/modules/rbac/rbac.service';
import { emailQueue } from '@/queues/index';

import { tenantBrandingRepo } from './tenant-branding.repository';
import { buildPlatformUrl, buildTenantUrl, getEffectiveUrlMode } from './tenant-url.service';
import { tenantEmailRepo } from './tenant-email.repository';
import {
  isReservedSlug,
  type CreateTenantDto,
  type OverrideTenantCustomDomainDto,
  type RequestBrandingUploadUrlDto,
  type SearchAuditLogsDto,
  type TestTenantEmailConfigDto,
  type UpdateTenantBrandingDto,
  type UpdateTenantDto,
  type UpdateTenantUrlSettingsDto,
  type UpsertTenantEmailConfigDto,
} from './tenants.dto';
import { tenantsRepo } from './tenants.repository';

export const DEFAULT_TENANT_PLAN = 'FREE';

export async function createTenantOrganization(
  creatorUserId: string,
  data: CreateTenantDto,
): Promise<PublicTenant> {
  const cleanSlug = data?.slug?.toLowerCase?.()?.trim?.() ?? '';
  const existing = await tenantsRepo.findTenantBySlug(cleanSlug);
  if (existing) {
    throw AppError.conflict('A tenant with this slug already exists');
  }

  // Provision tenant, owner membership, role, modules, and trialing subscription atomically in repository
  let tenantRecord: Tenant;
  try {
    tenantRecord = await tenantsRepo.provisionTenantTransaction({
      creatorUserId,
      name: data.name,
      slug: cleanSlug,
      planKey: DEFAULT_TENANT_PLAN,
    });
  } catch (err: unknown) {
    const errObj = (typeof err === 'object' && err !== null ? err : {}) as Record<string, unknown>;
    const errMsg = typeof errObj.message === 'string' ? errObj.message : '';
    if (
      errObj?.code === '23505' ||
      errMsg.includes('duplicate key') ||
      errMsg.includes('already exists')
    ) {
      throw AppError.conflict('A tenant with this slug already exists');
    }
    throw err;
  }

  // 6. External side effects: Record security audit event outside the DB transaction
  try {
    await logSecurityEvent({
      tenantId: tenantRecord.id,
      userId: creatorUserId,
      action: 'TENANT.CREATED',
      entityType: 'Tenant',
      entityId: tenantRecord.id,
      metadata: { name: tenantRecord.name, slug: tenantRecord.slug },
    });
  } catch {
    /* ignore logging failure */
  }

  return {
    id: tenantRecord.id,
    name: tenantRecord.name,
    slug: tenantRecord.slug,
    status: tenantRecord.status,
    plan: tenantRecord.plan,
    createdAt: tenantRecord.createdAt,
  };
}

export async function getUserTenants(userId: string): Promise<PublicTenant[]> {
  return tenantsRepo.findUserTenants(userId);
}

export async function getTenantDetails(tenantId: string): Promise<PublicTenant> {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant || tenant.deletedAt) throw AppError.notFound('Tenant not found');

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    plan: tenant.plan,
    createdAt: tenant.createdAt,
  };
}

export async function updateTenantDetails(
  tenantId: string,
  data: UpdateTenantDto,
): Promise<PublicTenant> {
  const updated = await tenantsRepo.updateTenant(tenantId, data);
  if (!updated) throw AppError.notFound('Tenant not found');

  return {
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    status: updated.status,
    plan: updated.plan,
    createdAt: updated.createdAt,
  };
}

export async function listMembers(tenantId: string) {
  return tenantsRepo.findTenantMembers(tenantId);
}

export async function addMemberToTenant(
  tenantId: string,
  operatorUserId: string,
  userEmail: string,
  roleName: string = rbacService.SYSTEM_ROLES.MEMBER,
): Promise<{
  member: TenantMember;
  role: string;
  inviteToken?: string;
  inviteUrl?: string;
  message?: string;
}> {
  // 1. Enforce SaaS Plan Seat Limits
  await billingService.enforceLimit(tenantId, 'maxMembers');

  const normalizedEmail = userEmail.toLowerCase().trim();
  let targetUser = await authRepo.findByEmail(normalizedEmail);
  let isNewUser = false;

  if (!targetUser) {
    // Automatically provision account in PENDING_VERIFICATION so the invitee can join seamlessly
    const dummyHash = await bcrypt.hash(randomUUID(), 12);
    const namePart = normalizedEmail.split('@')[0] || 'Member';
    const name = namePart.charAt(0).toUpperCase() + namePart.slice(1);
    const created = await authRepo.createUser({
      email: normalizedEmail,
      name,
      passwordHash: dummyHash,
    });
    targetUser = await authRepo.findById(created.id);
    isNewUser = true;
  }

  if (!targetUser) {
    throw AppError.internal('Failed to provision user for invitation');
  }

  const existing = await tenantsRepo.findTenantMember(tenantId, targetUser.id);
  if (existing) {
    throw AppError.conflict('User is already a member of this tenant');
  }

  const member = await tenantsRepo.addTenantMember({
    tenantId,
    userId: targetUser.id,
    status: 'INVITED',
  });

  // Find target role (either custom tenant role or system role)
  const availableRoles = await rbacRepo.findRolesByTenant(tenantId);
  const matchedRole = availableRoles.find((r) => r.name.toLowerCase() === roleName.toLowerCase());

  if (!matchedRole) {
    throw AppError.badRequest(`Role "${roleName}" is not valid for this tenant`);
  }

  await rbacRepo.assignRoleToMember(member.id, matchedRole.id);
  await rbacService.invalidateRbacCache(tenantId, targetUser.id);

  // Generate 48-hour invitation magic link token bound to this tenant
  const inviteToken = await createMagicLinkToken(targetUser.id, 48 * 3600, tenantId);
  const tenant = await tenantsRepo.findTenantById(tenantId);

  const inviteUrl = await buildTenantUrl(tenantId, `/accept-invite?token=${inviteToken}&tenant=${tenantId}`);

  await emailQueue.add(
    'tenant-invite',
    {
      to: targetUser.email,
      name: targetUser.name,
      tenantName: tenant?.name ?? 'Workspace',
      roleName: matchedRole.name,
      token: inviteToken,
      inviteUrl,
      tenantId,
    },
    { jobId: `invite-${tenantId}-${targetUser.id}-${Date.now()}` },
  );

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: isNewUser ? 'MEMBER.INVITED' : 'MEMBER.ADDED',
    entityType: 'TenantMember',
    entityId: member.id,
    metadata: { addedUserEmail: userEmail, role: matchedRole.name, isNewUser },
  });

  const exposeDev = Boolean(env.EXPOSE_DEV_TOKENS) && process.env.NODE_ENV !== 'production';

  return {
    member,
    role: matchedRole.name,
    inviteUrl: exposeDev ? inviteUrl : undefined,
    message: `Invitation successfully sent to ${normalizedEmail}`,
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

  await tenantsRepo.removeTenantMember(tenantId, memberId);
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

export async function bulkInviteMembers(
  tenantId: string,
  operatorUserId: string,
  invites: Array<{ email: string; role: string }>,
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
      const result = await addMemberToTenant(tenantId, operatorUserId, inv.email, inv.role);
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

export async function getTenantAuditTrail(tenantId: string, page = 1, limit = 50) {
  return auditRepo.findAuditLogs({ tenantId, page, limit });
}

export async function searchTenantAuditTrail(tenantId: string, filters: SearchAuditLogsDto) {
  return auditRepo.findAuditLogs({ ...filters, tenantId });
}

export async function getTenantEmailConfig(
  tenantId: string,
): Promise<PublicTenantEmailConfig | null> {
  const config = await tenantEmailRepo.findTenantEmailConfig(tenantId);
  if (!config) {
    return null;
  }

  return {
    id: config.id,
    tenantId: config.tenantId,
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    fromEmail: config.fromEmail,
    fromName: config?.fromName ?? null,
    replyTo: config?.replyTo ?? null,
    isEnabled: config.isEnabled,
    hasPassword: true,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export async function upsertTenantEmailConfig(
  tenantId: string,
  operatorUserId: string,
  data: UpsertTenantEmailConfigDto,
): Promise<PublicTenantEmailConfig> {
  const existing = await tenantEmailRepo.findTenantEmailConfig(tenantId);

  let passwordEncrypted: string;
  if (data?.password) {
    passwordEncrypted = encrypt(data.password);
  } else if (existing?.passwordEncrypted) {
    passwordEncrypted = existing.passwordEncrypted;
  } else {
    throw AppError.badRequest('Password is required when creating a new email configuration');
  }

  const record = await tenantEmailRepo.upsertTenantEmailConfig({
    tenantId,
    host: data?.host,
    port: data?.port ?? 587,
    secure: data?.secure ?? false,
    user: data?.user,
    passwordEncrypted,
    fromEmail: data?.fromEmail,
    fromName: data?.fromName ?? null,
    replyTo: data?.replyTo ?? null,
    isEnabled: data?.isEnabled ?? true,
  });

  await invalidateTenantEmailCache(tenantId);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'TENANT.EMAIL_CONFIG_UPDATED',
    entityType: 'TenantEmailConfig',
    entityId: record?.id,
    metadata: {
      host: data?.host,
      port: data?.port ?? 587,
      user: data?.user,
      fromEmail: data?.fromEmail,
    },
  });

  return {
    id: record.id,
    tenantId: record.tenantId,
    host: record.host,
    port: record.port,
    secure: record.secure,
    user: record.user,
    fromEmail: record.fromEmail,
    fromName: record?.fromName ?? null,
    replyTo: record?.replyTo ?? null,
    isEnabled: record.isEnabled,
    hasPassword: true,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function deleteTenantEmailConfig(
  tenantId: string,
  operatorUserId: string,
): Promise<{ message: string }> {
  const existing = await tenantEmailRepo.findTenantEmailConfig(tenantId);
  if (!existing) {
    throw AppError.notFound('No custom email configuration found for this tenant');
  }

  await tenantEmailRepo.deleteTenantEmailConfig(tenantId);
  await invalidateTenantEmailCache(tenantId);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'TENANT.EMAIL_CONFIG_DELETED',
    entityType: 'TenantEmailConfig',
    entityId: tenantId,
  });

  return { message: 'Custom email configuration removed. Organization will use system defaults.' };
}

export async function testTenantEmailConfig(
  tenantId: string,
  data: TestTenantEmailConfigDto,
): Promise<{ verified: boolean; message: string; testEmailSent: boolean }> {
  let host = data?.host;
  let port = data?.port ?? 587;
  let secure = data?.secure ?? false;
  let user = data?.user;
  let pass = data?.password;
  let fromEmail = data?.fromEmail;
  let fromName = data?.fromName;

  if (!host || !user || !pass) {
    const existing = await tenantEmailRepo.findTenantEmailConfig(tenantId);
    if (!existing) {
      throw AppError.badRequest(
        'Incomplete connection parameters provided and no saved email configuration exists for this organization',
      );
    }

    host = host ?? existing.host;
    port = data?.port ?? existing.port;
    secure = data?.secure ?? existing.secure;
    user = user ?? existing.user;
    fromEmail = fromEmail ?? existing.fromEmail;
    fromName = fromName ?? existing?.fromName ?? undefined;

    if (!pass) {
      try {
        pass = decrypt(existing.passwordEncrypted);
      } catch {
        throw AppError.badRequest('Failed to decrypt saved SMTP password for testing');
      }
    }
  }

  if (!host || !user || !pass) {
    throw AppError.badRequest('Host, username, and password are required to test connection');
  }

  const result = await verifySmtpConnection({
    host,
    port,
    secure,
    user,
    pass,
  });

  if (!result?.success) {
    return {
      verified: false,
      message: result?.message ?? 'SMTP connection failed',
      testEmailSent: false,
    };
  }

  let testEmailSent = false;
  if (data?.targetEmail) {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    const sender = fromName ? `"${fromName}" <${fromEmail ?? user}>` : (fromEmail ?? user);

    await transporter.sendMail({
      from: sender,
      to: data.targetEmail,
      subject: 'Test Email from Scalable Foundation',
      text: 'Congratulations! Your custom tenant SMTP configuration is working properly.',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>SMTP Connection Successful</h2>
          <p>This is a test email confirming that your organization's custom SMTP configuration is operating correctly.</p>
          <hr />
          <p style="color: #666; font-size: 12px;">Sent via custom tenant SMTP at ${new Date().toISOString()}</p>
        </div>
      `,
    });
    testEmailSent = true;
  }

  return {
    verified: true,
    message: testEmailSent
      ? `SMTP connection verified and test email sent to ${data?.targetEmail}`
      : 'SMTP connection verified successfully',
    testEmailSent,
  };
}

export interface PublicTenantResolution {
  kind: 'platform' | 'tenant';
  tenantId?: string;
  slug?: string;
  name?: string;
  status?: string;
  pathOnly?: boolean;
  canonicalBase?: string;
  urlMode?: 'path' | 'subdomain' | 'customDomain';
  allowed?: {
    path: true;
    subdomain: boolean;
    customDomain: boolean;
  };
  tenant?: {
    id: string;
    name: string;
    slug: string;
  };
  branding?: {
    companyName: string;
    logoUrl: string | null;
    logoDarkUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string;
    accentColor: string;
    secondaryColor?: string | null;
    primaryDarkColor?: string | null;
    accentDarkColor?: string | null;
    secondaryDarkColor?: string | null;
    fontFamily?: string | null;
    sidebarTheme?: string | null;
    borderRadius: string;
    authHeadline?: string | null;
    authSubtitle?: string | null;
    authCoverUrl?: string | null;
    authLayout?: string | null;
    customDomain: string | null;
    supportEmail: string | null;
  };
}

/**
 * Resolves a tenant by slug (path /:slug) or subdomain/custom domain with Redis caching.
 */
export async function resolvePublicTenant(options: {
  slug?: string;
  domain?: string;
  host?: string;
}): Promise<PublicTenantResolution> {
  const rawHost = options?.host?.trim().toLowerCase() || options?.domain?.trim().toLowerCase();
  const rawSlug = options?.slug?.trim().toLowerCase();

  if (!rawHost && !rawSlug) {
    throw AppError.badRequest('Either host, domain, or slug must be provided for resolution');
  }

  let host: string | undefined;
  if (rawHost) {
    // 1. Normalize host: lowercase, strip port, strip trailing dots
    let stripped = rawHost.split(':')[0] ?? rawHost;
    stripped = stripped.replace(/\.+$/, '');
    try {
      host = new URL(`http://${stripped}`).hostname.toLowerCase();
    } catch {
      throw AppError.badRequest('Invalid host format');
    }
  }

  const cacheKey = host ? `branding:resolve:${host}` : `branding:resolve:slug:${rawSlug}`;

  const cached = await cache.get<PublicTenantResolution | { notFound: true }>(cacheKey);
  if (cached) {
    if ('notFound' in cached && cached.notFound) {
      throw new AppError(404, 'Workspace not found', 'TENANT_NOT_FOUND');
    }
    return cached as PublicTenantResolution;
  }

  const baseDomain = env.APP_BASE_DOMAIN.toLowerCase().split(':')[0] ?? 'localhost';
  const platformHost = env.PLATFORM_HOST.toLowerCase().split(':')[0] ?? 'localhost';

  // 2. Check if platform host
  if (host && (host === baseDomain || host === platformHost)) {
    const result: PublicTenantResolution = {
      kind: 'platform',
      canonicalBase: buildPlatformUrl(),
    };
    await cache.set(cacheKey, result, 300);
    return result;
  }

  // 3. Check subdomain on base domain (or .localhost in dev)
  if (host) {
    const isSubdomainOfBase = host.endsWith(`.${baseDomain}`);
    const isSubdomainOfLocalhost =
      (baseDomain === 'localhost' || baseDomain.includes('localhost')) && host.endsWith('.localhost');

    if (isSubdomainOfBase || isSubdomainOfLocalhost) {
      const label = isSubdomainOfBase
        ? host.slice(0, -(baseDomain.length + 1))
        : (host.split('.')[0] ?? '');

      if (label && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
        if (isReservedSlug(label)) {
          if (['www', 'app', 'platform'].includes(label)) {
            const result: PublicTenantResolution = {
              kind: 'platform',
              canonicalBase: buildPlatformUrl(),
            };
            await cache.set(cacheKey, result, 300);
            return result;
          }
          await cache.set(cacheKey, { notFound: true }, 30);
          throw new AppError(404, 'Workspace not found', 'TENANT_NOT_FOUND');
        }

        const tenant = await tenantsRepo.findTenantBySlug(label);
        if (!tenant) {
          await cache.set(cacheKey, { notFound: true }, 30);
          throw new AppError(404, 'Workspace not found', 'TENANT_NOT_FOUND');
        }

        const entitlements = await billingService.getTenantEntitlements(tenant.id);
        const branding = await tenantBrandingRepo.findBrandingByTenantId(tenant.id);
        const effective = getEffectiveUrlMode(tenant, branding, entitlements, env);

        if (!entitlements.limits?.urlAccess?.subdomain) {
          const result: PublicTenantResolution = {
            kind: 'tenant',
            tenantId: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            status: tenant.status,
            pathOnly: true,
            canonicalBase: effective.canonicalBase,
            urlMode: effective.mode,
            allowed: effective.allowed,
          };
          await cache.set(cacheKey, result, 300);
          return result;
        }

        const result: PublicTenantResolution = {
          kind: 'tenant',
          tenantId: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status,
          tenant: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
          },
          branding: {
            companyName: branding?.companyName ?? tenant.name,
            logoUrl: branding?.logoUrl ?? null,
            logoDarkUrl: branding?.logoDarkUrl ?? null,
            faviconUrl: branding?.faviconUrl ?? null,
            primaryColor: branding?.primaryColor ?? '#4F46E5',
            accentColor: branding?.accentColor ?? '#06B6D4',
            secondaryColor: branding?.secondaryColor ?? null,
            primaryDarkColor: branding?.primaryDarkColor ?? null,
            accentDarkColor: branding?.accentDarkColor ?? null,
            secondaryDarkColor: branding?.secondaryDarkColor ?? null,
            fontFamily: branding?.fontFamily ?? 'Inter',
            sidebarTheme: branding?.sidebarTheme ?? 'DARK',
            borderRadius: branding?.borderRadius ?? '0.5rem',
            authHeadline: branding?.authHeadline ?? null,
            authSubtitle: branding?.authSubtitle ?? null,
            authCoverUrl: branding?.authCoverUrl ?? null,
            authLayout: branding?.authLayout ?? 'SPLIT',
            customDomain: branding?.customDomain ?? null,
            supportEmail: branding?.supportEmail ?? null,
          },
          urlMode: effective.mode,
          canonicalBase: effective.canonicalBase,
          allowed: effective.allowed,
        };
        await cache.set(cacheKey, result, 300);
        return result;
      }
    }

    // 4. Custom domain lookup (only where customDomainStatus === 'VERIFIED')
    const branding = await tenantBrandingRepo.findBrandingByCustomDomain(host);
    if (branding?.tenantId && branding.customDomainStatus === 'VERIFIED') {
      const tenant = await tenantsRepo.findTenantById(branding.tenantId);
      if (tenant) {
        const entitlements = await billingService.getTenantEntitlements(tenant.id);
        const effective = getEffectiveUrlMode(tenant, branding, entitlements, env);

        if (!entitlements.limits?.urlAccess?.customDomain) {
          const result: PublicTenantResolution = {
            kind: 'tenant',
            tenantId: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            status: tenant.status,
            pathOnly: true,
            canonicalBase: effective.canonicalBase,
            urlMode: effective.mode,
            allowed: effective.allowed,
          };
          await cache.set(cacheKey, result, 300);
          return result;
        }

        const result: PublicTenantResolution = {
          kind: 'tenant',
          tenantId: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status,
          tenant: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
          },
          branding: {
            companyName: branding.companyName ?? tenant.name,
            logoUrl: branding.logoUrl ?? null,
            logoDarkUrl: branding.logoDarkUrl ?? null,
            faviconUrl: branding.faviconUrl ?? null,
            primaryColor: branding.primaryColor ?? '#4F46E5',
            accentColor: branding.accentColor ?? '#06B6D4',
            secondaryColor: branding.secondaryColor ?? null,
            primaryDarkColor: branding.primaryDarkColor ?? null,
            accentDarkColor: branding.accentDarkColor ?? null,
            secondaryDarkColor: branding.secondaryDarkColor ?? null,
            fontFamily: branding.fontFamily ?? 'Inter',
            sidebarTheme: branding.sidebarTheme ?? 'DARK',
            borderRadius: branding.borderRadius ?? '0.5rem',
            authHeadline: branding.authHeadline ?? null,
            authSubtitle: branding.authSubtitle ?? null,
            authCoverUrl: branding.authCoverUrl ?? null,
            authLayout: branding.authLayout ?? 'SPLIT',
            customDomain: branding.customDomain ?? null,
            supportEmail: branding.supportEmail ?? null,
          },
          urlMode: effective.mode,
          canonicalBase: effective.canonicalBase,
          allowed: effective.allowed,
        };
        await cache.set(cacheKey, result, 300);
        return result;
      }
    }
  }

  // 5. Slug lookup
  if (rawSlug) {
    const tenant = await tenantsRepo.findTenantBySlug(rawSlug);
    if (tenant) {
      const branding = await tenantBrandingRepo.findBrandingByTenantId(tenant.id);
      const entitlements = await billingService.getTenantEntitlements(tenant.id);
      const effective = getEffectiveUrlMode(tenant, branding, entitlements, env);

      const result: PublicTenantResolution = {
        kind: 'tenant',
        tenantId: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
        },
        branding: {
          companyName: branding?.companyName ?? tenant.name,
          logoUrl: branding?.logoUrl ?? null,
          logoDarkUrl: branding?.logoDarkUrl ?? null,
          faviconUrl: branding?.faviconUrl ?? null,
          primaryColor: branding?.primaryColor ?? '#4F46E5',
          accentColor: branding?.accentColor ?? '#06B6D4',
          secondaryColor: branding?.secondaryColor ?? null,
          primaryDarkColor: branding?.primaryDarkColor ?? null,
          accentDarkColor: branding?.accentDarkColor ?? null,
          secondaryDarkColor: branding?.secondaryDarkColor ?? null,
          fontFamily: branding?.fontFamily ?? 'Inter',
          sidebarTheme: branding?.sidebarTheme ?? 'DARK',
          borderRadius: branding?.borderRadius ?? '0.5rem',
          authHeadline: branding?.authHeadline ?? null,
          authSubtitle: branding?.authSubtitle ?? null,
          authCoverUrl: branding?.authCoverUrl ?? null,
          authLayout: branding?.authLayout ?? 'SPLIT',
          customDomain: branding?.customDomain ?? null,
          supportEmail: branding?.supportEmail ?? null,
        },
        urlMode: effective.mode,
        canonicalBase: effective.canonicalBase,
        allowed: effective.allowed,
      };
      await cache.set(cacheKey, result, 300);
      return result;
    }
  }

  // Negative cache for 30s
  await cache.set(cacheKey, { notFound: true }, 30);
  throw new AppError(404, 'Workspace not found', 'TENANT_NOT_FOUND');
}

export async function getTenantBranding(tenantId: string): Promise<PublicTenantBranding> {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) {
    throw AppError.notFound('Tenant not found');
  }

  const branding = await tenantBrandingRepo.findBrandingByTenantId(tenantId);
  if (branding) {
    return branding;
  }

  // Return default placeholder branding if not configured yet
  return {
    id: 'default',
    tenantId,
    companyName: tenant.name,
    logoUrl: null,
    logoDarkUrl: null,
    faviconUrl: null,
    primaryColor: '#4F46E5',
    accentColor: '#06B6D4',
    secondaryColor: null,
    primaryDarkColor: null,
    accentDarkColor: null,
    secondaryDarkColor: null,
    fontFamily: 'Inter',
    sidebarTheme: 'DARK',
    borderRadius: '0.5rem',
    authHeadline: null,
    authSubtitle: null,
    authCoverUrl: null,
    authLayout: 'SPLIT',
    customDomain: null,
    customDomainStatus: 'PENDING',
    customDomainVerifiedAt: null,
    customDomainTlsStatus: null,
    supportEmail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function updateTenantBranding(
  tenantId: string,
  operatorUserId: string,
  data: UpdateTenantBrandingDto,
): Promise<PublicTenantBranding> {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) {
    throw AppError.notFound('Tenant not found');
  }

  if (data?.customDomain) {
    const entitlements = await billingService.getTenantEntitlements(tenantId);
    if (!entitlements.limits?.urlAccess?.customDomain) {
      throw new AppError(
        403,
        'Custom domain is not available on your plan. Upgrade to Enterprise to configure custom domains.',
        'PLAN_FEATURE_UNAVAILABLE',
        { feature: 'urlAccess.customDomain', requiredPlan: 'ENTERPRISE' },
      );
    }

    const cleanDomain = data.customDomain.toLowerCase().trim();
    const baseDomain = env.APP_BASE_DOMAIN.toLowerCase().split(':')[0] ?? 'localhost';
    if (cleanDomain === baseDomain || cleanDomain.endsWith(`.${baseDomain}`)) {
      throw new AppError(400, 'Custom domain cannot end with base domain', 'DOMAIN_RESERVED');
    }

    const existingDomain = await tenantBrandingRepo.findBrandingByCustomDomain(cleanDomain);
    if (existingDomain && existingDomain.tenantId !== tenantId) {
      throw new AppError(
        409,
        'This custom domain is already registered to another workspace',
        'DOMAIN_ALREADY_IN_USE',
      );
    }
  }

  const existing = await tenantBrandingRepo.findBrandingByTenantId(tenantId);

  // If custom domain is modified or removed, sync CORS and verification status
  if (data?.customDomain !== undefined) {
    const nextDomain = data.customDomain ? data.customDomain.toLowerCase().trim() : null;
    if (existing?.customDomain && existing.customDomain.toLowerCase() !== nextDomain) {
      await removeCorsCustomDomain(existing.customDomain);
      await tenantBrandingRepo.updateCustomDomainStatus(
        tenantId,
        'PENDING',
        null,
        nextDomain ? 'PENDING' : null,
      );
      if (!nextDomain && tenant.urlStyle === 'customDomain') {
        await tenantsRepo.updateTenantUrlStyle(tenantId, 'path');
      }
    }
  }

  const updated = await tenantBrandingRepo.upsertTenantBranding({
    tenantId,
    companyName: data?.companyName ?? existing?.companyName ?? tenant.name,
    logoUrl: data?.logoUrl !== undefined ? data.logoUrl : (existing?.logoUrl ?? null),
    logoDarkUrl:
      data?.logoDarkUrl !== undefined ? data.logoDarkUrl : (existing?.logoDarkUrl ?? null),
    faviconUrl: data?.faviconUrl !== undefined ? data.faviconUrl : (existing?.faviconUrl ?? null),
    primaryColor: data?.primaryColor ?? existing?.primaryColor ?? '#4F46E5',
    accentColor: data?.accentColor ?? existing?.accentColor ?? '#06B6D4',
    secondaryColor:
      data?.secondaryColor !== undefined
        ? (data.secondaryColor || null)
        : (existing?.secondaryColor ?? null),
    primaryDarkColor:
      data?.primaryDarkColor !== undefined
        ? (data.primaryDarkColor || null)
        : (existing?.primaryDarkColor ?? null),
    accentDarkColor:
      data?.accentDarkColor !== undefined
        ? (data.accentDarkColor || null)
        : (existing?.accentDarkColor ?? null),
    secondaryDarkColor:
      data?.secondaryDarkColor !== undefined
        ? (data.secondaryDarkColor || null)
        : (existing?.secondaryDarkColor ?? null),
    fontFamily: data?.fontFamily ?? existing?.fontFamily ?? 'Inter',
    sidebarTheme: data?.sidebarTheme ?? existing?.sidebarTheme ?? 'DARK',
    borderRadius: data?.borderRadius ?? existing?.borderRadius ?? '0.5rem',
    authHeadline:
      data?.authHeadline !== undefined ? (data.authHeadline || null) : (existing?.authHeadline ?? null),
    authSubtitle:
      data?.authSubtitle !== undefined ? (data.authSubtitle || null) : (existing?.authSubtitle ?? null),
    authCoverUrl:
      data?.authCoverUrl !== undefined ? (data.authCoverUrl || null) : (existing?.authCoverUrl ?? null),
    authLayout:
      data?.authLayout !== undefined ? (data.authLayout || 'SPLIT') : (existing?.authLayout ?? 'SPLIT'),
    customDomain:
      data?.customDomain !== undefined
        ? data.customDomain
          ? data.customDomain.toLowerCase()
          : null
        : (existing?.customDomain ?? null),
    supportEmail:
      data?.supportEmail !== undefined ? data.supportEmail : (existing?.supportEmail ?? null),
  });

  // Invalidate cached branding entries
  await cache.delByPrefix('branding:resolve:');
  await cache.del(`tenant-branding-email:${tenantId}`);
  await cache.delByPrefix(`tenant:url:${tenantId}`);
  await cache.del(`entitlements:${tenantId}`);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'TENANT.BRANDING_UPDATED',
    entityType: 'TenantBranding',
    entityId: updated.id,
    metadata: {
      primaryColor: updated.primaryColor,
      customDomain: updated.customDomain,
      companyName: updated.companyName,
    },
  });

  return updated;
}

export async function generateBrandingUploadUrl(
  tenantId: string,
  data: RequestBrandingUploadUrlDto,
): Promise<{ uploadUrl: string; fields: Record<string, string>; key: string; publicUrl: string }> {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) {
    throw AppError.notFound('Tenant not found');
  }

  const ext = data?.filename?.split('.').pop()?.toLowerCase() ?? 'png';
  const cleanExt = safeFilename(ext);
  const key = `tenants/${tenantId}/branding/${data.type}-${Date.now()}.${cleanExt}`;

  // Normalize content-type for S3 policy condition and browser compatibility
  let normalizedContentType = data?.contentType ?? 'image/png';
  if (
    ['ico', 'icon'].includes(cleanExt) ||
    [
      'image/x-icon',
      'image/vnd.microsoft.icon',
      'image/ico',
      'image/icon',
      'image/x-ico',
      'application/x-ico',
      'application/octet-stream',
    ].includes(normalizedContentType)
  ) {
    normalizedContentType = 'image/x-icon';
  } else if (cleanExt === 'svg' || normalizedContentType === 'image/svg+xml') {
    normalizedContentType = 'image/svg+xml';
  } else if (
    ['jpg', 'jpeg'].includes(cleanExt) ||
    normalizedContentType === 'image/jpeg' ||
    normalizedContentType === 'image/jpg'
  ) {
    normalizedContentType = 'image/jpeg';
  } else if (cleanExt === 'png' || normalizedContentType === 'image/png') {
    normalizedContentType = 'image/png';
  } else if (cleanExt === 'webp' || normalizedContentType === 'image/webp') {
    normalizedContentType = 'image/webp';
  }

  const post = await createUploadPost({
    key,
    contentType: normalizedContentType,
    expiresIn: 300,
  });

  const publicUrl = env.S3_ENDPOINT
    ? `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`
    : `https://${env.S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;

  return {
    uploadUrl: post.url,
    fields: post.fields,
    key,
    publicUrl,
  };
}

export async function verifyTenantCustomDomain(
  tenantId: string,
  operatorUserId: string,
  bypassVerification = false,
): Promise<PublicTenantBranding> {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) {
    throw AppError.notFound('Tenant not found');
  }

  // Plan gate: custom domain requires Enterprise unless staff bypasses
  if (!bypassVerification) {
    const entitlements = await billingService.getTenantEntitlements(tenantId);
    if (!entitlements.limits?.urlAccess?.customDomain) {
      throw new AppError(
        403,
        'Custom domain feature is not available on your current plan. Upgrade to Enterprise to verify custom domains.',
        'PLAN_FEATURE_UNAVAILABLE',
        { feature: 'urlAccess.customDomain', requiredPlan: 'ENTERPRISE' },
      );
    }
  }

  const branding = await tenantBrandingRepo.findBrandingByTenantId(tenantId);
  if (!branding || !branding.customDomain) {
    throw AppError.badRequest(
      'No custom domain configured for this workspace. Set a custom domain first before verifying.',
    );
  }

  const domain = branding.customDomain.toLowerCase();
  const challengeHostname = `_saas-verify.${domain}`;
  const expectedValue = `saas-verify=${tenantId}`;

  if (!bypassVerification) {
    try {
      const records = await dns.resolveTxt(challengeHostname);
      const flatRecords = records.flat();
      const matched = flatRecords.some(
        (entry) => entry.trim() === expectedValue || entry.trim() === tenantId,
      );

      if (!matched) {
        await tenantBrandingRepo.updateCustomDomainStatus(tenantId, 'FAILED', null, 'FAILED');
        throw new AppError(
          400,
          `DNS TXT record on "${challengeHostname}" did not match expected verification token "${expectedValue}". Found: [${flatRecords.join(', ')}]`,
          'DOMAIN_NOT_VERIFIED',
        );
      }
    } catch (err: unknown) {
      await tenantBrandingRepo.updateCustomDomainStatus(tenantId, 'FAILED', null, 'FAILED');
      if (err instanceof AppError) throw err;
      throw new AppError(
        400,
        `Failed to resolve DNS TXT record for "${challengeHostname}". Ensure the DNS TXT record is configured with "${expectedValue}" and has propagated.`,
        'DOMAIN_NOT_VERIFIED',
        { cause: (err as Error)?.message },
      );
    }
  }

  const updated = await tenantBrandingRepo.updateCustomDomainStatus(
    tenantId,
    'VERIFIED',
    new Date(),
    'ISSUED',
  );
  if (!updated) {
    throw AppError.internal('Failed to update domain verification status');
  }

  await addCorsCustomDomain(domain);

  // Invalidate branding caches
  await cache.delByPrefix('branding:resolve:');
  await cache.delByPrefix(`tenant:url:${tenantId}`);
  await cache.del(`entitlements:${tenantId}`);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'TENANT.DOMAIN_VERIFIED',
    entityType: 'TenantBranding',
    entityId: updated.id,
    metadata: {
      customDomain: updated.customDomain,
      customDomainStatus: 'VERIFIED',
      challengeHostname,
      bypassVerification,
    },
  });

  return updated;
}

export async function getTenantUrlSettings(tenantId: string) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const branding = await tenantBrandingRepo.findBrandingByTenantId(tenantId);
  const entitlements = await billingService.getTenantEntitlements(tenantId);
  const effective = getEffectiveUrlMode(tenant, branding, entitlements, env);

  const baseDomain = env.APP_BASE_DOMAIN || 'localhost:3001';
  const protocol = env.APP_PROTOCOL || (baseDomain.includes('localhost') ? 'http' : 'https');

  return {
    urlStyle: tenant.urlStyle ?? 'path',
    effective: effective.mode,
    allowed: effective.allowed,
    canonicalBase: effective.canonicalBase,
    reason: effective.reason,
    customDomain: branding?.customDomain ?? null,
    status: branding?.customDomainStatus ?? null,
    verifiedAt: branding?.customDomainVerifiedAt ?? null,
    instructions: {
      txtRecord: branding?.customDomain
        ? `_saas-verify.${branding.customDomain} = saas-verify=${tenant.id}`
        : null,
      cnameTarget: env.CUSTOM_DOMAIN_CNAME_TARGET,
    },
    urls: {
      path: `${protocol}://${baseDomain}/w/${tenant.slug}`,
      subdomain: effective.allowed.subdomain
        ? `${protocol}://${tenant.slug}.${baseDomain}`
        : undefined,
      customDomain: branding?.customDomain ? `https://${branding.customDomain}` : undefined,
    },
  };
}

export async function updateTenantUrlSettings(
  tenantId: string,
  operatorUserId: string,
  data: UpdateTenantUrlSettingsDto,
) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const entitlements = await billingService.getTenantEntitlements(tenantId);
  const existingBranding = await tenantBrandingRepo.findBrandingByTenantId(tenantId);

  // 1. Validate customDomain if changed
  if (data.customDomain !== undefined) {
    if (data.customDomain && data.customDomain.trim() !== '') {
      if (!entitlements.limits?.urlAccess?.customDomain) {
        throw new AppError(
          403,
          'Custom domain feature is not available on your plan. Upgrade to Enterprise to configure custom domains.',
          'PLAN_FEATURE_UNAVAILABLE',
          { feature: 'urlAccess.customDomain', requiredPlan: 'ENTERPRISE' },
        );
      }

      const cleanDomain = data.customDomain.toLowerCase().trim();
      const baseDomain = env.APP_BASE_DOMAIN.toLowerCase().split(':')[0] ?? 'localhost';
      if (cleanDomain === baseDomain || cleanDomain.endsWith(`.${baseDomain}`)) {
        throw new AppError(
          400,
          'Custom domain cannot end with the platform base domain',
          'DOMAIN_RESERVED',
        );
      }

      const existingByDomain = await tenantBrandingRepo.findBrandingByCustomDomain(cleanDomain);
      if (existingByDomain && existingByDomain.tenantId !== tenantId) {
        throw new AppError(
          409,
          'This custom domain is already registered to another workspace',
          'DOMAIN_ALREADY_IN_USE',
        );
      }

      if (cleanDomain !== existingBranding?.customDomain?.toLowerCase()) {
        if (existingBranding?.customDomain) {
          await removeCorsCustomDomain(existingBranding.customDomain);
        }
        await tenantBrandingRepo.updateCustomDomain(tenantId, cleanDomain);
        await tenantBrandingRepo.updateCustomDomainStatus(tenantId, 'PENDING', null, 'PENDING');
      }
    } else {
      if (existingBranding?.customDomain) {
        await removeCorsCustomDomain(existingBranding.customDomain);
      }
      await tenantBrandingRepo.updateCustomDomain(tenantId, null);
      await tenantBrandingRepo.updateCustomDomainStatus(tenantId, 'PENDING', null, null);
      if (tenant.urlStyle === 'customDomain') {
        await tenantsRepo.updateTenantUrlStyle(tenantId, 'path');
      }
    }
  }

  // 2. Validate urlStyle if changed
  if (data.urlStyle !== undefined) {
    if (data.urlStyle === 'subdomain' && !entitlements.limits?.urlAccess?.subdomain) {
      throw new AppError(
        403,
        'Subdomain URLs are not available on your current plan. Upgrade to Pro or Enterprise.',
        'PLAN_FEATURE_UNAVAILABLE',
        { feature: 'urlAccess.subdomain', requiredPlan: 'PRO' },
      );
    }
    if (data.urlStyle === 'customDomain' && !entitlements.limits?.urlAccess?.customDomain) {
      throw new AppError(
        403,
        'Custom domain URLs are not available on your current plan. Upgrade to Enterprise.',
        'PLAN_FEATURE_UNAVAILABLE',
        { feature: 'urlAccess.customDomain', requiredPlan: 'ENTERPRISE' },
      );
    }
    await tenantsRepo.updateTenantUrlStyle(tenantId, data.urlStyle);
  }

  await cache.delByPrefix('branding:resolve:');
  await cache.delByPrefix(`tenant:url:${tenantId}`);
  await cache.del(`entitlements:${tenantId}`);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'TENANT.URL_SETTINGS_UPDATED',
    entityType: 'Tenant',
    entityId: tenantId,
    metadata: {
      urlStyle: data.urlStyle,
      customDomain: data.customDomain,
    },
  });

  return getTenantUrlSettings(tenantId);
}

export async function deleteTenantCustomDomain(tenantId: string, operatorUserId: string) {
  return updateTenantUrlSettings(tenantId, operatorUserId, { customDomain: null, urlStyle: 'path' });
}

export async function overrideTenantUrlSettings(
  tenantId: string,
  staffId: string,
  data: OverrideTenantCustomDomainDto & { urlStyle?: 'path' | 'subdomain' | 'customDomain' },
) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const existingBranding = await tenantBrandingRepo.findBrandingByTenantId(tenantId);

  if (data.customDomain !== undefined) {
    const cleanDomain = data.customDomain?.toLowerCase().trim() || null;
    if (cleanDomain && cleanDomain !== existingBranding?.customDomain?.toLowerCase()) {
      if (existingBranding?.customDomain) {
        await removeCorsCustomDomain(existingBranding.customDomain);
      }
      await tenantBrandingRepo.updateCustomDomain(tenantId, cleanDomain);
    }
  }

  const status = data.status ?? 'VERIFIED';
  const verifiedAt = status === 'VERIFIED' ? new Date() : null;
  const tlsStatus = status === 'VERIFIED' ? 'ISSUED' : 'PENDING';
  await tenantBrandingRepo.updateCustomDomainStatus(tenantId, status, verifiedAt, tlsStatus);

  const updatedBranding = await tenantBrandingRepo.findBrandingByTenantId(tenantId);
  if (status === 'VERIFIED' && updatedBranding?.customDomain) {
    await addCorsCustomDomain(updatedBranding.customDomain);
  } else if (status !== 'VERIFIED' && updatedBranding?.customDomain) {
    await removeCorsCustomDomain(updatedBranding.customDomain);
  }

  if (data.urlStyle) {
    await tenantsRepo.updateTenantUrlStyle(tenantId, data.urlStyle);
  }

  await cache.delByPrefix('branding:resolve:');
  await cache.delByPrefix(`tenant:url:${tenantId}`);
  await cache.del(`entitlements:${tenantId}`);

  await auditRepo.createAuditLog({
    tenantId,
    action: 'PLATFORM.TENANT_URL_SETTINGS_OVERRIDE',
    entityType: 'Tenant',
    entityId: tenantId,
    actorType: 'PLATFORM_STAFF',
    actorStaffId: staffId,
    metadata: {
      customDomain: updatedBranding?.customDomain,
      status,
      urlStyle: data.urlStyle,
      reason: data.reason,
    },
  });

  return getTenantUrlSettings(tenantId);
}
