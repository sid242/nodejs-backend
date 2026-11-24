import nodemailer from 'nodemailer';

import { type PublicTenantEmailConfig } from '@/db/schema/index';
import { decrypt, encrypt } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import {
  invalidateTenantEmailCache,
  isPrivateOrReservedHost,
  verifySmtpConnection,
} from '@/lib/mailer';
import * as auditRepo from '@/modules/audit/audit.repository';
import { logSecurityEvent } from '@/modules/audit/audit.service';

import { tenantEmailRepo } from './tenant-email.repository';
import * as tenantSettingsRepo from './tenant-settings.repository';
import {
  type SearchAuditLogsDto,
  type TestTenantEmailConfigDto,
  type UpdateTenantSecurityPolicyDto,
  type UpdateTenantSettingsDto,
  type UpsertTenantEmailConfigDto,
} from './tenants.dto';
import { tenantsRepo } from './tenants.repository';

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
    lastTestedAt: config?.lastTestedAt ?? null,
    lastTestStatus: config?.lastTestStatus ?? null,
    dkimVerified: config?.dkimVerified ?? false,
    spfVerified: config?.spfVerified ?? false,
    dailyLimit: config?.dailyLimit ?? 1000,
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
  if (isPrivateOrReservedHost(data?.host)) {
    throw AppError.badRequest('SMTP host cannot be a private, loopback, or metadata address');
  }

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
    lastTestedAt: record?.lastTestedAt ?? null,
    lastTestStatus: record?.lastTestStatus ?? null,
    dkimVerified: record?.dkimVerified ?? false,
    spfVerified: record?.spfVerified ?? false,
    dailyLimit: record?.dailyLimit ?? 1000,
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

  if (isPrivateOrReservedHost(host)) {
    throw AppError.badRequest('SMTP host cannot be a private, loopback, or metadata address');
  }

  const result = await verifySmtpConnection({
    host,
    port,
    secure,
    user,
    pass,
  });

  try {
    await tenantEmailRepo.updateTenantEmailConfigTestStatus(
      tenantId,
      result?.success ? 'SUCCESS' : (result?.message ?? 'FAILED'),
    );
  } catch {
    // Non-blocking status update
  }

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

export async function getTenantSettings(tenantId: string) {
  const existing = await tenantSettingsRepo.findSettingsByTenantId(tenantId);
  if (existing) return existing;

  const tenant = await tenantsRepo.findTenantById(tenantId);
  return {
    tenantId,
    timezone: tenant?.timezone ?? 'UTC',
    locale: tenant?.locale ?? 'en-US',
    currency: tenant?.currency ?? 'USD',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: '24h',
    weekStartsOn: 'monday',
    fiscalYearStartMonth: 1,
    country: tenant?.country ?? 'US',
    industry: null,
    companySize: null,
    legalName: tenant?.legalName ?? null,
    taxId: null,
    billingAddressId: null,
    supportEmail: tenant?.supportEmail ?? null,
    websiteUrl: null,
    termsUrl: null,
    privacyUrl: null,
    defaultMemberRoleId: null,
    allowedEmailDomains: [],
    autoJoinDomains: false,
    memberLimitNotified: false,
  };
}

export async function updateTenantSettings(
  tenantId: string,
  data: UpdateTenantSettingsDto,
  actorUserId: string,
) {
  const updated = await tenantSettingsRepo.upsertSettings(tenantId, data);

  await auditRepo.createAuditLog({
    tenantId,
    action: 'TENANT.SETTINGS_UPDATED',
    entityType: 'TenantSetting',
    entityId: updated.id,
    actorType: 'USER',
    actorUserId,
    metadata: data as Record<string, unknown>,
  });

  return updated;
}

export async function getTenantSecurityPolicy(tenantId: string) {
  const existing = await tenantSettingsRepo.findSecurityPolicyByTenantId(tenantId);
  if (existing) return existing;

  return {
    tenantId,
    requireMfa: 'NONE',
    passwordMinLength: 8,
    passwordMaxAgeDays: null,
    sessionIdleMinutes: 60,
    sessionMaxHours: 24,
    ipAllowlist: [],
    allowedAuthMethods: ['PASSWORD', 'MAGIC', 'SSO'],
    enforceSso: false,
    allowSupportAccess: true,
    inviteExpiryDays: 7,
    allowPersonalEmails: true,
  };
}

export async function updateTenantSecurityPolicy(
  tenantId: string,
  data: UpdateTenantSecurityPolicyDto,
  actorUserId: string,
) {
  const updated = await tenantSettingsRepo.upsertSecurityPolicy(tenantId, data);

  await auditRepo.createAuditLog({
    tenantId,
    action: 'TENANT.SECURITY_POLICY_UPDATED',
    entityType: 'TenantSecurityPolicy',
    entityId: updated.id,
    actorType: 'USER',
    actorUserId,
    metadata: data as Record<string, unknown>,
  });

  return updated;
}
