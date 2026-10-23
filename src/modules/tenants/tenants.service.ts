import { randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';

import { db } from '@/config/db.js';
import { env } from '@/config/env.js';
import {
  appModules,
  tenantModules,
  type PublicTenant,
  type PublicTenantBranding,
  type PublicTenantEmailConfig,
  type PublicUser,
  type TenantMember,
} from '@/db/schema/index.js';
import { cache } from '@/lib/cache.js';
import { decrypt, encrypt } from '@/lib/crypto.js';
import { AppError } from '@/lib/errors.js';
import { invalidateTenantEmailCache, verifySmtpConnection } from '@/lib/mailer.js';
import { createUploadPost } from '@/lib/s3.js';
import { safeFilename } from '@/lib/utils.js';
import * as auditRepo from '@/modules/audit/audit.repository.js';
import { logSecurityEvent } from '@/modules/audit/audit.service.js';
import * as authRepo from '@/modules/auth/auth.repository.js';
import {
  createMagicLinkToken,
  issueTokens,
  revokeAllUserTokens,
  verifyAndConsumeMagicLinkToken,
} from '@/modules/auth/tokens.js';
import * as plansService from '@/modules/plans/plans.service.js';
import { rbacRepo } from '@/modules/rbac/rbac.repository.js';
import * as rbacService from '@/modules/rbac/rbac.service.js';
import { emailQueue } from '@/queues/index.js';

import { tenantBrandingRepo } from './tenant-branding.repository.js';
import { tenantEmailRepo } from './tenant-email.repository.js';
import type {
  RequestBrandingUploadUrlDto,
  SearchAuditLogsDto,
  TestTenantEmailConfigDto,
  UpdateTenantBrandingDto,
  UpsertTenantEmailConfigDto,
} from './tenants.dto.js';
import { tenantsRepo } from './tenants.repository.js';

export interface CreateTenantDto {
  name: string;
  slug: string;
  plan?: string;
}

export async function createTenantOrganization(
  creatorUserId: string,
  data: CreateTenantDto,
): Promise<PublicTenant> {
  const existing = await tenantsRepo.findTenantBySlug(data.slug);
  if (existing) {
    throw AppError.conflict('A tenant with this slug already exists');
  }

  // 1. Create tenant record
  const tenant = await tenantsRepo.createTenant({
    name: data.name,
    slug: data.slug.toLowerCase().trim(),
    plan: data.plan ?? 'FREE',
    status: 'ACTIVE',
  });

  // 2. Add creator as initial member
  const member = await tenantsRepo.addTenantMember({
    tenantId: tenant.id,
    userId: creatorUserId,
    status: 'ACTIVE',
  });

  // 3. Look up OWNER role (global system role)
  const systemRoles = await rbacRepo.findRolesByTenant(null);
  let ownerRole = systemRoles.find((r) => r.name === rbacService.SYSTEM_ROLES.OWNER);

  if (!ownerRole) {
    // Ensure default system roles are seeded
    await rbacService.seedDefaultRbac();
    const refreshed = await rbacRepo.findRolesByTenant(null);
    ownerRole = refreshed.find((r) => r.name === rbacService.SYSTEM_ROLES.OWNER);
  }

  if (ownerRole) {
    await rbacRepo.assignRoleToMember(member.id, ownerRole.id);
  }

  // 4. Provision default tenant modules
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

  // 5. Assign initial subscription
  await plansService.assignInitialSubscription(tenant.id, tenant.plan ?? 'FREE');

  // 6. Record audit event
  await logSecurityEvent({
    tenantId: tenant.id,
    userId: creatorUserId,
    action: 'TENANT.CREATED',
    entityType: 'Tenant',
    entityId: tenant.id,
    metadata: { name: tenant.name, slug: tenant.slug },
  });

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    plan: tenant.plan,
    createdAt: tenant.createdAt,
  };
}

export async function getUserTenants(
  userId: string,
  isSystemAdmin?: boolean,
): Promise<PublicTenant[]> {
  if (isSystemAdmin) {
    return tenantsRepo.findAllActiveTenants();
  }
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
  data: Partial<CreateTenantDto>,
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
  await plansService.checkTenantSeatLimit(tenantId);

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
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
  const inviteUrl = `${frontendUrl}/accept-invite?token=${inviteToken}&tenant=${tenantId}`;

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

  return {
    member,
    role: matchedRole.name,
    inviteToken,
    inviteUrl,
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

  // If the invitation was explicitly bound to a workspace, ensure consistency
  if (boundTenantId && expectedTenantId && boundTenantId !== expectedTenantId) {
    throw AppError.forbidden('Invitation token does not belong to the requested workspace');
  }

  const targetTenantId = boundTenantId || expectedTenantId;

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

  // Activate ONLY the target tenant membership for this user (never blindly activate all memberships across other tenants)
  const memberships = await tenantsRepo.findMembershipsByUserId(userId);
  let activeTenantId: string | undefined = undefined;
  for (const m of memberships) {
    if (targetTenantId) {
      if (m.tenantId === targetTenantId) {
        if (m.status === 'INVITED') {
          await tenantsRepo.updateTenantMemberStatus(m.id, 'ACTIVE');
          await rbacService.invalidateRbacCache(m.tenantId, userId);
        }
        activeTenantId = m.tenantId;
      }
    } else {
      if (m.status === 'INVITED') {
        await tenantsRepo.updateTenantMemberStatus(m.id, 'ACTIVE');
        await rbacService.invalidateRbacCache(m.tenantId, userId);
        activeTenantId = m.tenantId;
      } else if (m.status === 'ACTIVE' && !activeTenantId) {
        activeTenantId = m.tenantId;
      }
    }
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
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  branding: {
    companyName: string;
    logoUrl: string | null;
    logoDarkUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string;
    accentColor: string;
    borderRadius: string;
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
}): Promise<PublicTenantResolution | null> {
  const normalizedSlug = options?.slug?.trim().toLowerCase();
  const normalizedDomain = options?.domain?.trim().toLowerCase();
  const rawHost = options?.host?.trim().toLowerCase();

  const cacheKey = `branding:resolve:${normalizedSlug ?? ''}:${normalizedDomain ?? ''}:${rawHost ?? ''}`;

  return cache.wrap(cacheKey, 3600, async () => {
    let targetTenant: PublicTenant | null = null;

    // 1. Resolve by explicit slug (e.g., example.com/test)
    if (normalizedSlug) {
      targetTenant = await tenantsRepo.findTenantBySlug(normalizedSlug);
    }

    // 2. Resolve by domain or host (e.g., test.example.com or portal.acme.com)
    const domainToInspect = normalizedDomain ?? rawHost;
    if (!targetTenant && domainToInspect) {
      // Clean port if present (e.g., "test.localhost:3000" -> "test.localhost")
      const hostname = domainToInspect.split(':')[0] ?? domainToInspect;

      // 2a. Check custom domain match
      const brandingByDomain = await tenantBrandingRepo.findBrandingByCustomDomain(hostname);
      if (brandingByDomain?.tenantId) {
        targetTenant = await tenantsRepo.findTenantById(brandingByDomain.tenantId);
      }

      // 2b. Check subdomain match (e.g., "test.example.com" -> slug: "test")
      if (!targetTenant) {
        const parts = hostname.split('.');
        if (parts.length > 2 || (parts.length === 2 && parts[1] === 'localhost')) {
          const potentialSubdomain = parts[0];
          if (potentialSubdomain && potentialSubdomain !== 'www' && potentialSubdomain !== 'api') {
            targetTenant = await tenantsRepo.findTenantBySlug(potentialSubdomain);
          }
        }
      }
    }

    if (!targetTenant) {
      return null;
    }

    const branding = await tenantBrandingRepo.findBrandingByTenantId(targetTenant.id);

    return {
      tenant: {
        id: targetTenant.id,
        name: targetTenant.name,
        slug: targetTenant.slug,
      },
      branding: {
        companyName: branding?.companyName ?? targetTenant.name,
        logoUrl: branding?.logoUrl ?? null,
        logoDarkUrl: branding?.logoDarkUrl ?? null,
        faviconUrl: branding?.faviconUrl ?? null,
        primaryColor: branding?.primaryColor ?? '#4F46E5',
        accentColor: branding?.accentColor ?? '#06B6D4',
        borderRadius: branding?.borderRadius ?? '0.5rem',
        customDomain: branding?.customDomain ?? null,
        supportEmail: branding?.supportEmail ?? null,
      },
    };
  });
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
    borderRadius: '0.5rem',
    customDomain: null,
    customDomainStatus: 'PENDING',
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
    const existingDomain = await tenantBrandingRepo.findBrandingByCustomDomain(data.customDomain);
    if (existingDomain && existingDomain.tenantId !== tenantId) {
      throw AppError.conflict('This custom domain is already registered to another workspace');
    }
  }

  const updated = await tenantBrandingRepo.upsertTenantBranding({
    tenantId,
    companyName: data?.companyName ?? tenant.name,
    logoUrl: data?.logoUrl,
    logoDarkUrl: data?.logoDarkUrl,
    faviconUrl: data?.faviconUrl,
    primaryColor: data?.primaryColor ?? '#4F46E5',
    accentColor: data?.accentColor ?? '#06B6D4',
    borderRadius: data?.borderRadius ?? '0.5rem',
    customDomain: data?.customDomain ? data.customDomain.toLowerCase() : null,
    supportEmail: data?.supportEmail,
  });

  // Invalidate cached branding entries
  await cache.delByPrefix('branding:resolve:');

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

  const ext = data?.filename?.split('.').pop() ?? 'png';
  const cleanExt = safeFilename(ext);
  const key = `tenants/${tenantId}/branding/${data.type}-${Date.now()}.${cleanExt}`;

  const post = await createUploadPost({
    key,
    contentType: data.contentType,
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
        throw AppError.badRequest(
          `DNS TXT record on "${challengeHostname}" did not match expected verification token "${expectedValue}". Found: [${flatRecords.join(', ')}]`,
        );
      }
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw AppError.badRequest(
        `Failed to resolve DNS TXT record for "${challengeHostname}". Ensure the DNS TXT record is configured with "${expectedValue}" and has propagated.`,
        { cause: (err as Error)?.message },
      );
    }
  }

  const updated = await tenantBrandingRepo.updateCustomDomainStatus(tenantId, 'ACTIVE');
  if (!updated) {
    throw AppError.internal('Failed to update domain verification status');
  }

  // Invalidate branding caches
  await cache.delByPrefix('branding:resolve:');

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'TENANT.DOMAIN_VERIFIED',
    entityType: 'TenantBranding',
    entityId: updated.id,
    metadata: {
      customDomain: updated.customDomain,
      customDomainStatus: 'ACTIVE',
      challengeHostname,
    },
  });

  return updated;
}
