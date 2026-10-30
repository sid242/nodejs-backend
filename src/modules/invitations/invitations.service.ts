import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

import { env } from '@/config/env';
import { type PublicUser } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import * as authRepo from '@/modules/auth/auth.repository';
import { issueTokens } from '@/modules/auth/tokens';
import { enforceLimit } from '@/modules/billing/billing.service';
import * as rbacRepo from '@/modules/rbac/rbac.repository';
import * as rbacService from '@/modules/rbac/rbac.service';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';
import { buildTenantUrl } from '@/modules/tenants/tenant-url.service';
import { emailQueue } from '@/queues/index';

import * as invitationsRepo from './invitations.repository';

function hashInvitationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface CreateInvitationDto {
  email: string;
  roleId?: string;
  role?: string;
}

export interface AcceptInvitationDto {
  token: string;
  name?: string;
  password?: string;
}

// ==========================================
// 1. Invitation Lifecycle Services
// ==========================================

export async function createTenantInvitation(
  tenantId: string,
  actor: { userId?: string; staffId?: string },
  dto: CreateInvitationDto,
) {
  const normalizedEmail = dto.email.trim().toLowerCase();

  // 1. Enforce seat limits (active members + pending invitations <= maxMembers)
  await enforceLimit(tenantId, 'maxMembers', 1);

  // 2. Resolve target role
  let roleId = dto.roleId;
  let targetRole;

  if (roleId) {
    targetRole = await rbacRepo.findRoleById(roleId);
  } else if (dto.role) {
    const tenantRoles = await rbacRepo.findRolesByTenant(tenantId);
    targetRole = tenantRoles.find((r) => r.name.toLowerCase() === dto.role!.toLowerCase());
    roleId = targetRole?.id;
  }

  if (!targetRole || !roleId) {
    throw AppError.badRequest('Invalid workspace role specified for invitation');
  }

  // Ensure role belongs to this tenant or is global system role
  if (targetRole.tenantId && targetRole.tenantId !== tenantId) {
    throw AppError.forbidden('Specified role does not belong to this workspace');
  }

  // 3. Privilege checks for caller
  if (actor.userId) {
    const callerPerms = await rbacRepo.getEffectivePermissions(tenantId, actor.userId);
    const isCallerOwner = callerPerms.roles.some((r) => r.toLowerCase() === 'owner');
    const isInvitingOwner = targetRole.name.toLowerCase() === 'owner';

    if (isInvitingOwner && !isCallerOwner) {
      throw AppError.forbidden('Only workspace owners can invite another owner');
    }

    if (!isCallerOwner && !isInvitingOwner) {
      // Permission subset check: operator cannot grant permissions they do not possess
      const targetRolePermKeys = await rbacRepo.getRolePermissionKeys(roleId);
      const callerPermSet = new Set(callerPerms.permissions);
      const isSubset = targetRolePermKeys.every((p) => callerPermSet.has(p) || callerPermSet.has('*'));
      if (!isSubset) {
        throw AppError.forbidden('Cannot invite a member with permissions exceeding your own role');
      }
    }
  }

  // 4. Check if existing user is already an active member of this tenant
  const existingUser = await authRepo.findByEmail(normalizedEmail);
  if (existingUser) {
    const member = await tenantsRepo.findTenantMember(tenantId, existingUser.id);
    if (member && member.status === 'ACTIVE') {
      throw AppError.conflict('A member with this email already belongs to this workspace');
    }
  }

  // 5. Check if an active invitation already exists for this email in this tenant
  const pendingInvitation = await invitationsRepo.findPendingInvitationByEmail(
    tenantId,
    normalizedEmail,
  );
  if (pendingInvitation) {
    throw AppError.conflict('A pending invitation for this email already exists in this workspace');
  }

  // 6. Generate random single-use token and hash
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInvitationToken(rawToken);
  const expiresAt = new Date(Date.now() + 48 * 3600 * 1000); // 48 hours

  const invitation = await invitationsRepo.createInvitation({
    tenantId,
    email: normalizedEmail,
    roleId,
    invitedByUserId: actor.userId ?? null,
    invitedByStaffId: actor.staffId ?? null,
    tokenHash,
    status: 'PENDING',
    expiresAt,
  });

  const tenant = await tenantsRepo.findTenantById(tenantId);

  const inviteUrl = await buildTenantUrl(tenantId, `/accept-invite?token=${rawToken}`);

  // 7. Dispatch invitation email via BullMQ
  await emailQueue.add(
    'tenant-invite',
    {
      to: normalizedEmail,
      tenantName: tenant?.name ?? 'Workspace',
      roleName: targetRole.name,
      token: rawToken,
      inviteUrl,
      tenantId,
    },
    { jobId: `invite-${tenantId}-${invitation.id}-${Date.now()}` },
  );

  await logSecurityEvent({
    tenantId,
    userId: actor.userId,
    action: 'MEMBER.INVITED',
    entityType: 'TenantInvitation',
    entityId: invitation.id,
    metadata: { email: normalizedEmail, role: targetRole.name },
  });

  const exposeDev = Boolean(env.EXPOSE_DEV_TOKENS) && process.env.NODE_ENV !== 'production';

  return {
    invitation: {
      id: invitation.id,
      email: invitation.email,
      roleId: invitation.roleId,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    },
    roleName: targetRole.name,
    inviteUrl: exposeDev ? inviteUrl : undefined,
    message: `Invitation successfully sent to ${normalizedEmail}`,
  };
}

export async function listTenantInvitations(tenantId: string) {
  return invitationsRepo.listInvitations(tenantId);
}

export async function revokeTenantInvitation(tenantId: string, invitationId: string, actorUserId?: string) {
  const invitation = await invitationsRepo.findInvitationById(tenantId, invitationId);
  if (!invitation) throw AppError.notFound('Invitation not found');
  if (invitation.status !== 'PENDING') {
    throw AppError.badRequest('Only pending invitations can be revoked');
  }

  const revoked = await invitationsRepo.revokeInvitation(tenantId, invitationId);

  await logSecurityEvent({
    tenantId,
    userId: actorUserId,
    action: 'INVITATION.REVOKED',
    entityType: 'TenantInvitation',
    entityId: invitationId,
    metadata: { email: invitation.email },
  });

  return revoked;
}

export async function resendTenantInvitation(tenantId: string, invitationId: string) {
  const invitation = await invitationsRepo.findInvitationById(tenantId, invitationId);
  if (!invitation) throw AppError.notFound('Invitation not found');
  if (invitation.status !== 'PENDING') {
    throw AppError.badRequest('Only pending invitations can be resent');
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInvitationToken(rawToken);
  const expiresAt = new Date(Date.now() + 48 * 3600 * 1000);

  await invitationsRepo.updateInvitation(invitationId, {
    tokenHash,
    expiresAt,
  });

  const tenant = await tenantsRepo.findTenantById(tenantId);

  const inviteUrl = await buildTenantUrl(tenantId, `/accept-invite?token=${rawToken}`);

  await emailQueue.add(
    'tenant-invite',
    {
      to: invitation.email,
      tenantName: tenant?.name ?? 'Workspace',
      roleName: invitation.roleName ?? 'Member',
      token: rawToken,
      inviteUrl,
      tenantId,
    },
    { jobId: `resend-${tenantId}-${invitationId}-${Date.now()}` },
  );

  const exposeDev = Boolean(env.EXPOSE_DEV_TOKENS) && process.env.NODE_ENV !== 'production';

  return {
    success: true,
    message: `Invitation resent to ${invitation.email}`,
    inviteUrl: exposeDev ? inviteUrl : undefined,
  };
}

// ==========================================
// 2. Acceptance & Preview Services (Public)
// ==========================================

export async function previewInvitation(token: string) {
  if (!token) throw AppError.badRequest('Token parameter is required');

  const tokenHash = hashInvitationToken(token);
  const invitation = await invitationsRepo.findInvitationByTokenHash(tokenHash);

  if (!invitation) {
    throw AppError.badRequest('Invalid or expired invitation token');
  }

  if (invitation.status !== 'PENDING') {
    throw AppError.badRequest(`This invitation has already been ${invitation.status.toLowerCase()}`);
  }

  if (new Date() > new Date(invitation.expiresAt)) {
    await invitationsRepo.updateInvitation(invitation.id, { status: 'EXPIRED' });
    throw AppError.badRequest('This invitation token has expired');
  }

  const existingUser = await authRepo.findByEmail(invitation.email);

  return {
    email: invitation.email,
    tenantName: invitation.tenantName ?? 'Workspace',
    tenantSlug: invitation.tenantSlug,
    roleName: invitation.roleName ?? 'Member',
    expiresAt: invitation.expiresAt,
    hasAccount: Boolean(existingUser),
  };
}

export async function acceptTenantInvitation(
  dto: AcceptInvitationDto,
  clientUser?: PublicUser | null,
) {
  if (!dto.token) throw AppError.badRequest('Invitation token is required');

  const tokenHash = hashInvitationToken(dto.token);
  const invitation = await invitationsRepo.findInvitationByTokenHash(tokenHash);

  if (!invitation) {
    throw AppError.badRequest('Invalid or expired invitation token');
  }

  if (invitation.status !== 'PENDING') {
    throw AppError.badRequest(`This invitation has already been ${invitation.status.toLowerCase()}`);
  }

  if (new Date() > new Date(invitation.expiresAt)) {
    await invitationsRepo.updateInvitation(invitation.id, { status: 'EXPIRED' });
    throw AppError.badRequest('This invitation token has expired');
  }

  const normalizedInvitedEmail = invitation.email.toLowerCase();
  const existingUser = await authRepo.findByEmail(normalizedInvitedEmail);

  let targetUserId: string;
  let userForTokens: PublicUser;

  if (existingUser) {
    // If the invitee already has an account, they MUST be logged in as that account to accept
    if (!clientUser) {
      return {
        requiresLogin: true,
        email: invitation.email,
        message: 'Account exists. Please log in with your credentials to accept this invitation.',
      };
    }

    if (clientUser.email.toLowerCase() !== normalizedInvitedEmail) {
      throw AppError.forbidden(
        `You are currently logged in as ${clientUser.email}. Please switch to ${invitation.email} to accept this invitation.`,
      );
    }

    targetUserId = existingUser.id;
    userForTokens = clientUser;
  } else {
    // New user path: requires name & password to set up new account
    if (!dto.password || dto.password.length < 8) {
      throw AppError.badRequest('Password of at least 8 characters is required to create your account');
    }

    const name = dto.name?.trim() || normalizedInvitedEmail.split('@')[0] || 'User';
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const createdUser = await invitationsRepo.createInvitedUser({
      email: normalizedInvitedEmail,
      name,
      passwordHash,
    });

    targetUserId = createdUser.id;
    userForTokens = {
      id: createdUser.id,
      email: createdUser.email,
      name: createdUser.name,
      status: createdUser.status,
      emailVerifiedAt: createdUser.emailVerifiedAt,
      phoneNumber: createdUser.phoneNumber,
      phoneVerifiedAt: createdUser.phoneVerifiedAt,
      twoFactorEnabledAt: createdUser.twoFactorEnabledAt,
      createdAt: createdUser.createdAt,
    };
  }

  // Atomically create/activate membership, assign role, and mark invitation ACCEPTED
  await invitationsRepo.executeAcceptanceTransaction({
    tenantId: invitation.tenantId,
    userId: targetUserId,
    roleId: invitation.roleId,
    invitationId: invitation.id,
  });

  // Invalidate RBAC cache
  await rbacService.invalidateRbacCache(invitation.tenantId, targetUserId);

  await logSecurityEvent({
    tenantId: invitation.tenantId,
    userId: targetUserId,
    action: 'INVITATION.ACCEPTED',
    entityType: 'TenantInvitation',
    entityId: invitation.id,
    metadata: { email: invitation.email, roleId: invitation.roleId },
  });

  const tokens = await issueTokens(userForTokens);

  return {
    success: true,
    message: 'Invitation accepted successfully',
    user: userForTokens,
    activeTenantId: invitation.tenantId,
    tenantSlug: invitation.tenantSlug,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}
