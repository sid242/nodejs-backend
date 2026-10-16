import { AppError } from '@/lib/errors.js';
import { tenantsRepo } from './tenants.repository.js';
import { tenantEmailRepo } from './tenant-email.repository.js';
import { encrypt, decrypt } from '@/lib/crypto.js';
import { verifySmtpConnection, invalidateTenantEmailCache } from '@/lib/mailer.js';
import { rbacRepo } from '@/modules/rbac/rbac.repository.js';
import * as rbacService from '@/modules/rbac/rbac.service.js';
import * as authRepo from '@/modules/auth/auth.repository.js';
import { revokeAllUserTokens } from '@/modules/auth/tokens.js';
import * as auditRepo from '@/modules/audit/audit.repository.js';
import { logSecurityEvent } from '@/modules/audit/audit.service.js';
import { db } from '@/config/db.js';
import nodemailer from 'nodemailer';
import type { UpsertTenantEmailConfigDto, TestTenantEmailConfigDto } from './tenants.dto.js';
import {
  appModules,
  tenantModules,
  type PublicTenant,
  type TenantMember,
  type PublicTenantEmailConfig,
} from '@/db/schema/index.js';

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

  // 5. Record audit event
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
): Promise<{ member: TenantMember; role: string }> {
  const targetUser = await authRepo.findByEmail(userEmail);
  if (!targetUser) {
    throw AppError.notFound(`User with email "${userEmail}" not found. User must register first.`);
  }

  const existing = await tenantsRepo.findTenantMember(tenantId, targetUser.id);
  if (existing) {
    throw AppError.conflict('User is already a member of this tenant');
  }

  const member = await tenantsRepo.addTenantMember({
    tenantId,
    userId: targetUser.id,
    status: 'ACTIVE',
  });

  // Find target role (either custom tenant role or system role)
  const availableRoles = await rbacRepo.findRolesByTenant(tenantId);
  const matchedRole = availableRoles.find((r) => r.name.toLowerCase() === roleName.toLowerCase());

  if (!matchedRole) {
    throw AppError.badRequest(`Role "${roleName}" is not valid for this tenant`);
  }

  await rbacRepo.assignRoleToMember(member.id, matchedRole.id);
  await rbacService.invalidateRbacCache(tenantId, targetUser.id);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'MEMBER.ADDED',
    entityType: 'TenantMember',
    entityId: member.id,
    metadata: { addedUserEmail: userEmail, role: matchedRole.name },
  });

  return { member, role: matchedRole.name };
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

export async function getTenantAuditTrail(tenantId: string, page = 1, limit = 50) {
  return auditRepo.findAuditLogs({ tenantId, page, limit });
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
      } catch (err) {
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

