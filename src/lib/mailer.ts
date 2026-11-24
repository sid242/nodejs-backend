import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import nodemailer from 'nodemailer';

import { env, isProd } from '@/config/env';
import { logger } from '@/config/logger';
import { cache } from '@/lib/cache';
import { decrypt } from '@/lib/crypto';
import * as emailRepo from '@/modules/email-templates/email-templates.repository';
import { tenantEmailRepo } from '@/modules/tenants/tenant-email.repository';

const ses = new SESv2Client({ region: env.AWS_REGION });

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  tenantId?: string;
  templateId?: string;
  templateSlug?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export interface SmtpConnectionOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail?: string;
  fromName?: string;
}

/**
 * Validates whether a host points to a private, loopback, link-local, or cloud metadata network.
 * Used to protect against Server-Side Request Forgery (SSRF) during SMTP connection testing.
 */
export function isPrivateOrReservedHost(host: string): boolean {
  if (!host) return true;
  const normalized = host.trim().toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized === '0.0.0.0' ||
    normalized === '::1'
  ) {
    return true;
  }

  // IPv4 checks
  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / AWS metadata
    if (a === 0) return true;
  }

  // IPv6 checks
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80')) {
    return true;
  }

  return false;
}

/**
 * Verifies that the provided SMTP credentials can successfully connect and authenticate.
 */
export async function verifySmtpConnection(
  options: SmtpConnectionOptions,
): Promise<{ success: boolean; message: string }> {
  if (isPrivateOrReservedHost(options?.host)) {
    return {
      success: false,
      message: 'SMTP host cannot be a private, loopback, or metadata address',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: options?.host,
      port: options?.port ?? 587,
      secure: options?.secure ?? false,
      auth: {
        user: options?.user,
        pass: options?.pass,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });

    await transporter.verify();
    return { success: true, message: 'SMTP connection verified successfully' };
  } catch (err: any) {
    const message = err?.message ?? 'Failed to connect to SMTP server';
    logger.warn({ err, host: options?.host, port: options?.port }, 'SMTP verification failed');
    return { success: false, message };
  }
}

/**
 * Invalidates the Redis-cached tenant email configuration.
 */
export async function invalidateTenantEmailCache(tenantId: string): Promise<void> {
  if (!tenantId) return;
  await cache.del(`tenant-email:${tenantId}`);
}

/**
 * Sends an email using:
 * 1. Tenant-specific SMTP configuration if `tenantId` is supplied and configured.
 * 2. System SMTP (if configured or EMAIL_PROVIDER is 'smtp').
 * 3. AWS SES v2 in production.
 * 4. Logs to console/logger in development if no live transport is active.
 *
 * Verifies recipient against tenant suppression list and records delivery attempt in email_messages.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  tenantId,
  templateId,
  templateSlug,
  fromName,
  fromEmail,
  replyTo,
  relatedEntityType,
  relatedEntityId,
}: SendEmailOptions): Promise<{
  success: boolean;
  messageId?: string;
  skippedSuppressed?: boolean;
}> {
  const normalizedTo = to.toLowerCase().trim();

  // Check suppression list if tenant-scoped
  if (tenantId) {
    try {
      const isSuppressed = await emailRepo.isEmailSuppressed(tenantId, normalizedTo);
      if (isSuppressed) {
        logger.warn(
          { to: normalizedTo, tenantId, subject },
          '[mailer] recipient is in suppression list, skipping delivery',
        );
        await emailRepo.recordEmailMessage({
          tenantId,
          templateId: templateId ?? null,
          templateSlug: templateSlug ?? null,
          to: normalizedTo,
          subject,
          status: 'FAILED',
          attempts: 1,
          lastError: 'Recipient address is suppressed (bounced or complained)',
          relatedEntityType: relatedEntityType ?? null,
          relatedEntityId: relatedEntityId ?? null,
        });
        return { success: false, skippedSuppressed: true };
      }
    } catch (suppErr) {
      logger.warn({ err: suppErr, to: normalizedTo, tenantId }, 'Failed checking suppression list');
    }
  }

  // 1. Check for Tenant-specific custom SMTP configuration
  if (tenantId) {
    try {
      const tenantConfig = await cache.wrap(`tenant-email:${tenantId}`, 300, async () =>
        tenantEmailRepo.findTenantEmailConfig(tenantId),
      );

      if (
        tenantConfig?.isEnabled &&
        tenantConfig?.host &&
        tenantConfig?.user &&
        tenantConfig?.passwordEncrypted
      ) {
        let decryptedPass = '';
        try {
          decryptedPass = decrypt(tenantConfig.passwordEncrypted);
        } catch (decErr) {
          logger.error({ err: decErr, tenantId }, 'Failed to decrypt tenant SMTP password');
        }

        if (decryptedPass) {
          const tenantTransporter = nodemailer.createTransport({
            host: tenantConfig.host,
            port: tenantConfig.port ?? 587,
            secure: tenantConfig.secure ?? false,
            auth: {
              user: tenantConfig.user,
              pass: decryptedPass,
            },
          });

          const effectiveFromName = fromName || tenantConfig.fromName;
          const effectiveFromEmail = fromEmail || tenantConfig.fromEmail;
          const effectiveReplyTo = replyTo || tenantConfig?.replyTo || undefined;

          const from = effectiveFromName
            ? `"${effectiveFromName}" <${effectiveFromEmail}>`
            : effectiveFromEmail;

          const info = await tenantTransporter.sendMail({
            from,
            to: normalizedTo,
            subject,
            html,
            text,
            replyTo: effectiveReplyTo,
          });

          const providerMessageId = info?.messageId || null;
          logger.info(
            { to: normalizedTo, subject, tenantId, host: tenantConfig.host, providerMessageId },
            '[mailer] sent via tenant SMTP',
          );

          await emailRepo.recordEmailMessage({
            tenantId,
            templateId: templateId ?? null,
            templateSlug: templateSlug ?? null,
            to: normalizedTo,
            subject,
            status: 'SENT',
            provider: 'tenant-smtp',
            providerMessageId: providerMessageId ?? undefined,
            sentAt: new Date(),
            attempts: 1,
            relatedEntityType: relatedEntityType ?? null,
            relatedEntityId: relatedEntityId ?? null,
          });

          return { success: true, messageId: providerMessageId ?? undefined };
        }
      }
    } catch (err: any) {
      logger.error(
        { err, tenantId, to: normalizedTo, subject },
        'Tenant SMTP delivery failed, falling back to system default',
      );
    }
  }

  // 2. System Default: SMTP Provider
  if (env.EMAIL_PROVIDER === 'smtp' || (env.SMTP_HOST && !env.SES_FROM_EMAIL)) {
    if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
      try {
        const systemTransporter = nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT ?? 587,
          secure: env.SMTP_SECURE ?? false,
          auth: {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
          },
        });

        const effectiveFromName = fromName || env.SMTP_FROM_NAME;
        const effectiveFromEmail = fromEmail || env.SMTP_FROM_EMAIL || env.SMTP_USER;
        const effectiveReplyTo = replyTo || undefined;

        const from = effectiveFromName
          ? `"${effectiveFromName}" <${effectiveFromEmail}>`
          : effectiveFromEmail;

        const info = await systemTransporter.sendMail({
          from,
          to: normalizedTo,
          subject,
          html,
          text,
          replyTo: effectiveReplyTo,
        });

        const providerMessageId = info?.messageId || null;
        logger.info(
          { to: normalizedTo, subject, host: env.SMTP_HOST, providerMessageId },
          '[mailer] sent via system SMTP',
        );

        if (tenantId) {
          await emailRepo.recordEmailMessage({
            tenantId,
            templateId: templateId ?? null,
            templateSlug: templateSlug ?? null,
            to: normalizedTo,
            subject,
            status: 'SENT',
            provider: 'system-smtp',
            providerMessageId: providerMessageId ?? undefined,
            sentAt: new Date(),
            attempts: 1,
            relatedEntityType: relatedEntityType ?? null,
            relatedEntityId: relatedEntityId ?? null,
          });
        }

        return { success: true, messageId: providerMessageId ?? undefined };
      } catch (sysErr: any) {
        logger.error({ err: sysErr, to: normalizedTo, subject }, 'System SMTP delivery failed');
        if (tenantId) {
          await emailRepo.recordEmailMessage({
            tenantId,
            templateId: templateId ?? null,
            templateSlug: templateSlug ?? null,
            to: normalizedTo,
            subject,
            status: 'FAILED',
            provider: 'system-smtp',
            lastError: sysErr?.message ?? 'System SMTP delivery failed',
            attempts: 1,
            relatedEntityType: relatedEntityType ?? null,
            relatedEntityId: relatedEntityId ?? null,
          });
        }
        throw sysErr;
      }
    }
  }

  // 3. System Default: AWS SES v2
  if (isProd && (fromEmail || env.SES_FROM_EMAIL)) {
    try {
      const sesSender = fromName
        ? `"${fromName}" <${fromEmail || env.SES_FROM_EMAIL}>`
        : fromEmail || env.SES_FROM_EMAIL;

      const sesRes = await ses.send(
        new SendEmailCommand({
          FromEmailAddress: sesSender,
          Destination: { ToAddresses: [normalizedTo] },
          ReplyToAddresses: replyTo ? [replyTo] : undefined,
          Content: { Simple: { Subject: { Data: subject }, Body: { Html: { Data: html } } } },
        }),
      );
      const providerMessageId = sesRes.MessageId || null;
      logger.info({ to: normalizedTo, subject, providerMessageId }, '[mailer] sent via AWS SES v2');

      if (tenantId) {
        await emailRepo.recordEmailMessage({
          tenantId,
          templateId: templateId ?? null,
          templateSlug: templateSlug ?? null,
          to: normalizedTo,
          subject,
          status: 'SENT',
          provider: 'aws-ses',
          providerMessageId: providerMessageId ?? undefined,
          sentAt: new Date(),
          attempts: 1,
          relatedEntityType: relatedEntityType ?? null,
          relatedEntityId: relatedEntityId ?? null,
        });
      }

      return { success: true, messageId: providerMessageId ?? undefined };
    } catch (sesErr: any) {
      logger.error({ err: sesErr, to: normalizedTo, subject }, 'AWS SES delivery failed');
      if (tenantId) {
        await emailRepo.recordEmailMessage({
          tenantId,
          templateId: templateId ?? null,
          templateSlug: templateSlug ?? null,
          to: normalizedTo,
          subject,
          status: 'FAILED',
          provider: 'aws-ses',
          lastError: sesErr?.message ?? 'AWS SES delivery failed',
          attempts: 1,
          relatedEntityType: relatedEntityType ?? null,
          relatedEntityId: relatedEntityId ?? null,
        });
      }
      throw sesErr;
    }
  }

  // 4. Development Fallback Logger
  logger.info(
    { to: normalizedTo, subject, tenantId, fromName, fromEmail, replyTo },
    '[mailer] (not sent: non-prod or no live email provider configured)',
  );

  if (tenantId) {
    await emailRepo.recordEmailMessage({
      tenantId,
      templateId: templateId ?? null,
      templateSlug: templateSlug ?? null,
      to: normalizedTo,
      subject,
      status: 'SENT',
      provider: 'dev-console',
      sentAt: new Date(),
      attempts: 1,
      relatedEntityType: relatedEntityType ?? null,
      relatedEntityId: relatedEntityId ?? null,
    });
  }

  return { success: true, messageId: `dev-${Date.now()}` };
}
