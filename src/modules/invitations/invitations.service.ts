import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { env } from '@/config/env';
import { users, verificationTokens, type PublicUser } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import * as authRepo from '@/modules/auth/auth.repository';
import { issueTokens } from '@/modules/auth/tokens';
import { enforceLimit } from '@/modules/billing/billing.service';
import * as rbacRepo from '@/modules/rbac/rbac.repository';
import * as rbacService from '@/modules/rbac/rbac.service';
import { assertSsoNotEnforced } from '@/modules/sso/sso.enforcement';
import { buildTenantUrl } from '@/modules/tenants/tenant-url.service';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';
import { emailQueue } from '@/queues/index';

import * as invitationsRepo from './invitations.repository';

function hashInvitationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface CreateInvitationDto {
  email: string;
  roleId?: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  memberCode?: string;
  jobTitle?: string;
  department?: string;
  message?: string;
  expiresInHours?: number;
}

export interface AcceptInvitationDto {
  token: string;
  firstName?: string;
  lastName?: string;
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
      const isSubset = targetRolePermKeys.every(
        (p) => callerPermSet.has(p) || callerPermSet.has('*'),
      );
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
  const expirationHours = dto.expiresInHours ?? 48;
  const expiresAt = new Date(Date.now() + expirationHours * 3600 * 1000);

  const invitation = await invitationsRepo.createInvitation({
    tenantId,
    email: normalizedEmail,
    roleId,
    invitedByUserId: actor.userId ?? null,
    invitedByStaffId: actor.staffId ?? null,
    tokenHash,
    status: 'PENDING',
    firstName: dto.firstName?.trim() ?? null,
    lastName: dto.lastName?.trim() ?? null,
    phone: dto.phone?.trim() ?? null,
    memberCode: dto.memberCode?.trim() ?? null,
    jobTitle: dto.jobTitle?.trim() ?? null,
    department: dto.department?.trim() ?? null,
    message: dto.message?.trim() ?? null,
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

export async function revokeTenantInvitation(
  tenantId: string,
  invitationId: string,
  actorUserId?: string,
) {
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

  if (invitation) {
    if (invitation.status !== 'PENDING') {
      throw AppError.badRequest(
        `This invitation has already been ${invitation.status.toLowerCase()}`,
      );
    }

    if (new Date() > new Date(invitation.expiresAt)) {
      await invitationsRepo.updateInvitation(invitation.id, { status: 'EXPIRED' });
      throw AppError.badRequest('This invitation token has expired');
    }

    const existingUser = await authRepo.findByEmail(invitation.email);

    return {
      email: invitation.email,
      firstName: invitation.firstName ?? existingUser?.firstName ?? undefined,
      lastName: invitation.lastName ?? existingUser?.lastName ?? undefined,
      tenantName: invitation.tenantName ?? 'Workspace',
      tenantSlug: invitation.tenantSlug,
      roleName: invitation.roleName ?? 'Member',
      expiresAt: invitation.expiresAt,
      hasAccount: Boolean(existingUser),
    };
  }

  // Fallback: Check verificationTokens for magic-link based workspace invitation
  const [magicToken] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(eq(verificationTokens.tokenHash, tokenHash), eq(verificationTokens.type, 'MAGIC_LINK')),
    )
    .limit(1);

  if (magicToken) {
    if (magicToken.usedAt) {
      throw AppError.badRequest('This invitation has already been used');
    }

    if (new Date() > new Date(magicToken.expiresAt)) {
      throw AppError.badRequest('This invitation token has expired');
    }

    const user = await authRepo.findById(magicToken.userId);
    if (!user) {
      throw AppError.badRequest('Invited user record not found');
    }

    const tenant = magicToken.target ? await tenantsRepo.findTenantById(magicToken.target) : null;
    let roleName = 'Member';
    if (magicToken.target) {
      const member = await tenantsRepo.findTenantMember(magicToken.target, user.id);
      if (member) {
        const roles = await rbacRepo.getMemberRoles(member.id);
        if (roles && roles.length > 0) {
          roleName = roles?.[0]?.name ?? 'Member';
        }
      }
    }

    const hasRealAccount = Boolean(
      user.emailVerifiedAt &&
      user.status !== 'PENDING_VERIFICATION' &&
      user.passwordHash &&
      !user.passwordHash.startsWith('$2a$12$dummy'),
    );

    return {
      email: user.email,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
      tenantName: tenant?.name ?? 'Workspace',
      tenantSlug: tenant?.slug,
      roleName,
      expiresAt: magicToken.expiresAt,
      hasAccount: hasRealAccount,
    };
  }

  throw AppError.badRequest('Invalid or expired invitation token');
}

export async function acceptTenantInvitation(
  dto: AcceptInvitationDto,
  clientUser?: PublicUser | null,
) {
  if (!dto.token) throw AppError.badRequest('Invitation token is required');

  const tokenHash = hashInvitationToken(dto.token);
  const invitation = await invitationsRepo.findInvitationByTokenHash(tokenHash);

  if (invitation) {
    if (invitation.status !== 'PENDING') {
      throw AppError.badRequest(
        `This invitation has already been ${invitation.status.toLowerCase()}`,
      );
    }

    if (new Date() > new Date(invitation.expiresAt)) {
      await invitationsRepo.updateInvitation(invitation.id, { status: 'EXPIRED' });
      throw AppError.badRequest('This invitation token has expired');
    }

    const normalizedInvitedEmail = invitation.email.toLowerCase();
    const existingUser = await authRepo.findByEmail(normalizedInvitedEmail);

    // Mandatory SSO enforcement check
    await assertSsoNotEnforced({
      email: normalizedInvitedEmail,
      userId: existingUser?.id,
      targetTenantId: invitation.tenantId,
    });

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
        throw AppError.badRequest(
          'Password of at least 8 characters is required to create your account',
        );
      }

      const first =
        dto.firstName?.trim() ||
        invitation.firstName ||
        normalizedInvitedEmail.split('@')[0] ||
        'User';
      const last = dto.lastName?.trim() || invitation.lastName || 'Member';
      const passwordHash = await bcrypt.hash(dto.password, 12);

      const createdUser = await invitationsRepo.createInvitedUser({
        email: normalizedInvitedEmail,
        firstName: first,
        lastName: last,
        passwordHash,
      });

      targetUserId = createdUser.id;
      userForTokens = {
        id: createdUser.id,
        email: createdUser.email,
        firstName: createdUser.firstName,
        lastName: createdUser.lastName,
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
      memberMetadata: {
        memberCode: invitation.memberCode,
        phone: invitation.phone,
        jobTitle: invitation.jobTitle,
        department: invitation.department,
      },
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

  // Fallback: Check verificationTokens for magic-link based workspace invitation
  const [magicToken] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(eq(verificationTokens.tokenHash, tokenHash), eq(verificationTokens.type, 'MAGIC_LINK')),
    )
    .limit(1);

  if (!magicToken) {
    throw AppError.badRequest('Invalid or expired invitation token');
  }

  if (magicToken.usedAt) {
    throw AppError.badRequest('This invitation has already been used');
  }

  if (new Date() > new Date(magicToken.expiresAt)) {
    throw AppError.badRequest('This invitation token has expired');
  }

  const boundTenantId = magicToken.target;
  if (!boundTenantId) {
    throw AppError.badRequest('Invitation token is not bound to a workspace');
  }

  const targetUser = await authRepo.findById(magicToken.userId);
  if (!targetUser || targetUser.deletedAt) {
    throw AppError.unauthorized('User not found');
  }

  if (targetUser.status === 'SUSPENDED' || targetUser.status === 'DEACTIVATED') {
    throw AppError.forbidden(`Account is ${targetUser.status.toLowerCase()}`);
  }

  const normalizedInvitedEmail = targetUser.email.toLowerCase();

  // Mandatory SSO enforcement check
  await assertSsoNotEnforced({
    email: normalizedInvitedEmail,
    userId: targetUser.id,
    targetTenantId: boundTenantId,
  });

  const isPendingUser = !targetUser.emailVerifiedAt || targetUser.status === 'PENDING_VERIFICATION';

  let userForTokens: PublicUser;

  if (isPendingUser || dto.password) {
    // New user path setting their password
    if (dto.password) {
      if (dto.password.length < 8) {
        throw AppError.badRequest('Password must be at least 8 characters');
      }
      const newHash = await bcrypt.hash(dto.password, 12);
      await db
        .update(users)
        .set({
          passwordHash: newHash,
          firstName: dto.firstName?.trim() || targetUser.firstName,
          lastName: dto.lastName?.trim() || targetUser.lastName,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetUser.id));
    } else {
      await authRepo.markEmailVerified(targetUser.id);
    }

    const updatedUser = await authRepo.findPublicUserById(targetUser.id);
    if (!updatedUser) throw AppError.internal('Failed to retrieve user status');
    userForTokens = updatedUser;
  } else {
    // Existing user path
    if (!clientUser) {
      return {
        requiresLogin: true,
        email: targetUser.email,
        message: 'Account exists. Please log in with your credentials to accept this invitation.',
      };
    }

    if (clientUser.email.toLowerCase() !== normalizedInvitedEmail) {
      throw AppError.forbidden(
        `You are currently logged in as ${clientUser.email}. Please switch to ${targetUser.email} to accept this invitation.`,
      );
    }

    userForTokens = clientUser;
  }

  // Activate tenant membership for this workspace
  const memberships = await tenantsRepo.findMembershipsByUserId(targetUser.id);
  let activeTenantFound = false;

  for (const m of memberships) {
    if (m.tenantId === boundTenantId) {
      activeTenantFound = true;
      if (m.status === 'INVITED') {
        await tenantsRepo.updateTenantMemberStatus(m.id, 'ACTIVE');
        await rbacService.invalidateRbacCache(m.tenantId, targetUser.id);
      }
    }
  }

  if (!activeTenantFound) {
    const defaultRoles = await rbacRepo.findRolesByTenant(boundTenantId);
    const memberRole = defaultRoles.find((r) => r.name.toLowerCase() === 'member');
    const createdMember = await tenantsRepo.addTenantMember({
      tenantId: boundTenantId,
      userId: targetUser.id,
      status: 'ACTIVE',
    });
    if (memberRole) {
      await rbacRepo.assignRoleToMember(createdMember.id, memberRole.id);
    }
    await rbacService.invalidateRbacCache(boundTenantId, targetUser.id);
  }

  // Mark verification token as used atomically
  await db
    .update(verificationTokens)
    .set({ usedAt: new Date() })
    .where(eq(verificationTokens.id, magicToken.id));

  const tenant = await tenantsRepo.findTenantById(boundTenantId);

  await logSecurityEvent({
    tenantId: boundTenantId,
    userId: targetUser.id,
    action: 'INVITATION.ACCEPTED',
    entityType: 'TenantMember',
    entityId: targetUser.id,
    metadata: { email: normalizedInvitedEmail },
  });

  const tokens = await issueTokens(userForTokens);

  return {
    success: true,
    message: 'Invitation accepted successfully',
    user: userForTokens,
    activeTenantId: boundTenantId,
    tenantSlug: tenant?.slug,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}
