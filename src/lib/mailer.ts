import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import nodemailer from 'nodemailer';

import { env, isProd } from '@/config/env.js';
import { logger } from '@/config/logger.js';
import { cache } from '@/lib/cache.js';
import { decrypt } from '@/lib/crypto.js';
import { tenantEmailRepo } from '@/modules/tenants/tenant-email.repository.js';

const ses = new SESv2Client({ region: env.AWS_REGION });

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  tenantId?: string;
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
 * Verifies that the provided SMTP credentials can successfully connect and authenticate.
 */
export async function verifySmtpConnection(
  options: SmtpConnectionOptions,
): Promise<{ success: boolean; message: string }> {
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
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  tenantId,
}: SendEmailOptions): Promise<void> {
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

          const from = tenantConfig.fromName
            ? `"${tenantConfig.fromName}" <${tenantConfig.fromEmail}>`
            : tenantConfig.fromEmail;

          await tenantTransporter.sendMail({
            from,
            to,
            subject,
            html,
            text,
            replyTo: tenantConfig?.replyTo ?? undefined,
          });

          logger.info(
            { to, subject, tenantId, host: tenantConfig.host },
            '[mailer] sent via tenant SMTP',
          );
          return;
        }
      }
    } catch (err) {
      logger.error(
        { err, tenantId, to, subject },
        'Tenant SMTP delivery failed, falling back to system default',
      );
    }
  }

  // 2. System Default: SMTP Provider
  if (env.EMAIL_PROVIDER === 'smtp' || (env.SMTP_HOST && !env.SES_FROM_EMAIL)) {
    if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
      const systemTransporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 587,
        secure: env.SMTP_SECURE ?? false,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });

      const from = env.SMTP_FROM_NAME
        ? `"${env.SMTP_FROM_NAME}" <${env.SMTP_FROM_EMAIL ?? env.SMTP_USER}>`
        : (env.SMTP_FROM_EMAIL ?? env.SMTP_USER);

      await systemTransporter.sendMail({
        from,
        to,
        subject,
        html,
        text,
      });

      logger.info({ to, subject, host: env.SMTP_HOST }, '[mailer] sent via system SMTP');
      return;
    }
  }

  // 3. System Default: AWS SES v2
  if (isProd && env.SES_FROM_EMAIL) {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: env.SES_FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject }, Body: { Html: { Data: html } } } },
      }),
    );
    logger.info({ to, subject }, '[mailer] sent via AWS SES v2');
    return;
  }

  // 4. Development Fallback Logger
  logger.info(
    { to, subject, tenantId },
    '[mailer] (not sent: non-prod or no live email provider configured)',
  );
}
