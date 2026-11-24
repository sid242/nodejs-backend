import type { IncomingHttpHeaders } from 'node:http';
import { and, desc, eq, ilike } from 'drizzle-orm';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { redis } from '@/config/redis';
import {
  emailMessages,
  emailTemplates,
  tenantMembers,
  users,
  type EmailMessage,
  type EmailSuppression,
  type EmailTemplate,
  type EmailTemplateVersion,
} from '@/db/schema/index';
import { primaryDbHandle, tenantDb } from '@/db/tenancy/context';
import { safeEqual } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { sendEmail } from '@/lib/mailer';
import { generateSlug } from '@/lib/utils';
import { logSecurityEvent } from '@/modules/audit/audit.service';

import {
  createEmailTemplateDto,
  type BounceWebhookDto,
  type CreateEmailTemplateDto,
  type CreateEmailTemplateInput,
  type CreateSuppressionDto,
  type ListDeliveryLogsQueryDto,
  type ListEmailTemplatesQueryDto,
  type ListSuppressionsQueryDto,
  type TestSendEmailTemplateDto,
  type UpdateEmailTemplateDto,
} from './email-templates.dto';
import * as repo from './email-templates.repository';

// ---------------------------------------------------------------------------
// Constants & Security Rules
// ---------------------------------------------------------------------------

const MAX_HTML_SIZE_BYTES = 512 * 1024; // 512 KB
const MAX_TEST_SENDS_PER_DAY = 25;

export const SYSTEM_TEMPLATE_REQUIRED_VARS: Record<string, string[]> = {
  'verify-email': ['link', 'verificationUrl'],
  'password-reset': ['link', 'resetUrl'],
  'magic-link': ['link', 'loginUrl'],
  'tenant-invite': ['link', 'inviteUrl'],
};

// ---------------------------------------------------------------------------
// HTML Sanitisation & Variable Rendering
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeHtmlContent(html: string): string {
  if (!html) return '';

  const byteLength = Buffer.byteLength(html, 'utf8');
  if (byteLength > MAX_HTML_SIZE_BYTES) {
    throw AppError.badRequest(
      `HTML content exceeds maximum allowed size of 512 KB (${Math.round(byteLength / 1024)} KB provided)`,
    );
  }

  // Strip <script> tags and their contents
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Strip inline JavaScript event handlers (e.g. onload=, onclick=, onerror=)
  sanitized = sanitized.replace(/\son[a-zA-Z]+\s*=\s*(['"]).*?\1/gi, '');
  sanitized = sanitized.replace(/\son[a-zA-Z]+\s*=\s*[^\s>]+/gi, '');

  // Strip javascript: pseudo-protocols in href and src attributes
  sanitized = sanitized.replace(/(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '$1="#"');

  return sanitized;
}

export function extractVariables(html: string, subject = ''): string[] {
  const combined = `${html} ${subject}`;
  const matches = combined.match(/\{\{\{?([a-zA-Z0-9_.]+)\}?\}\}/g) || [];
  return Array.from(new Set(matches.map((m) => m.replace(/^\{\{\{?|\}?\}\}$/g, '').trim()))).filter(
    Boolean,
  );
}

function resolveNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), obj);
}

export function renderVariables(template: string, variables: Record<string, any>): string {
  if (!template) return '';

  // 1. First replace raw/unescaped triple braces {{{key}}}
  let result = template.replace(/\{\{\{([a-zA-Z0-9_.]+)\}\}\}/g, (match, key) => {
    const val = resolveNestedValue(variables, key);
    return val !== undefined && val !== null ? String(val) : match;
  });

  // 2. Then replace HTML-escaped double braces {{key}}
  result = result.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (match, key) => {
    const val = resolveNestedValue(variables, key);
    return val !== undefined && val !== null ? escapeHtml(String(val)) : match;
  });

  return result;
}

function validateSystemTemplateVariables(slug: string, html: string, subject = ''): void {
  const requiredCandidates = SYSTEM_TEMPLATE_REQUIRED_VARS[slug];
  if (!requiredCandidates || requiredCandidates.length === 0) {
    return;
  }

  const variables = extractVariables(html, subject);
  const hasAtLeastOne = requiredCandidates.some((reqVar) => variables.includes(reqVar));

  if (!hasAtLeastOne) {
    throw AppError.badRequest(
      `System template '${slug}' must include at least one required variable: ${requiredCandidates.map((v) => `{{${v}}}`).join(' or ')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Template CRUD
// ---------------------------------------------------------------------------

export async function listTemplates(
  tenantId: string,
  options: Partial<ListEmailTemplatesQueryDto> = {},
) {
  return repo.findTemplatesByTenant(tenantId, options);
}

export async function getTemplate(id: string, tenantId: string): Promise<EmailTemplate> {
  const template = await repo.findTemplateById(id, tenantId);
  if (!template) {
    throw AppError.notFound('Email template not found');
  }
  return template;
}

export async function createTemplate(
  tenantId: string,
  userId: string,
  rawData: CreateEmailTemplateInput,
): Promise<EmailTemplate> {
  const data = createEmailTemplateDto.parse(rawData);
  const baseSlug = data.slug || generateSlug(data.name);
  let finalSlug = baseSlug;

  const existing = await repo.findTemplateBySlug(finalSlug, tenantId, data.locale ?? 'en');
  if (existing) {
    finalSlug = `${baseSlug}-${Date.now().toString().slice(-4)}`;
  }

  const sanitizedHtml = sanitizeHtmlContent(data.htmlContent);

  if (data.isSystemOverride || SYSTEM_TEMPLATE_REQUIRED_VARS[finalSlug]) {
    validateSystemTemplateVariables(finalSlug, sanitizedHtml, data.subject);
  }

  const detectedVariables = Array.from(
    new Set([...extractVariables(sanitizedHtml, data.subject), ...(data.variables || [])]),
  );

  return repo.createTemplate({
    tenantId,
    name: data.name,
    slug: finalSlug,
    locale: data.locale ?? 'en',
    subject: data.subject,
    category: data.category,
    status: data.status,
    description: data.description,
    senderName: data.senderName,
    fromEmail: data.fromEmail,
    replyTo: data.replyTo,
    htmlContent: sanitizedHtml,
    designJson: data.designJson,
    variables: detectedVariables,
    isSystemOverride: data.isSystemOverride ?? false,
    currentVersion: 1,
    createdById: userId,
  });
}

export async function updateTemplate(
  id: string,
  tenantId: string,
  userId: string,
  data: UpdateEmailTemplateDto,
): Promise<EmailTemplate> {
  const existing = await getTemplate(id, tenantId);

  const html = data.htmlContent ? sanitizeHtmlContent(data.htmlContent) : existing.htmlContent;
  const subject = data.subject ?? existing.subject;
  const slug = data.slug ?? existing.slug;

  if (existing.isSystemOverride || data.isSystemOverride || SYSTEM_TEMPLATE_REQUIRED_VARS[slug]) {
    validateSystemTemplateVariables(slug, html, subject);
  }

  // Create version snapshot before updating
  await repo.createTemplateVersion({
    tenantId,
    templateId: existing.id,
    version: existing.currentVersion,
    subject: existing.subject,
    htmlContent: existing.htmlContent,
    designJson: existing.designJson,
    variables: existing.variables,
    createdById: userId,
  });

  const nextVersion = existing.currentVersion + 1;
  const detectedVariables = Array.from(
    new Set([...extractVariables(html, subject), ...(data.variables || existing.variables || [])]),
  );

  const updated = await repo.updateTemplate(id, tenantId, {
    ...data,
    htmlContent: html,
    variables: detectedVariables,
    currentVersion: nextVersion,
    lastPublishedAt: data.status === 'PUBLISHED' ? new Date() : existing.lastPublishedAt,
  });

  if (!updated) {
    throw AppError.notFound('Email template not found');
  }
  return updated;
}

export async function deleteTemplate(id: string, tenantId: string): Promise<{ success: boolean }> {
  const existing = await getTemplate(id, tenantId);
  if (existing.isSystemOverride) {
    throw AppError.forbidden('System default templates cannot be deleted');
  }

  const deleted = await repo.deleteTemplate(id, tenantId);
  if (!deleted) {
    throw AppError.notFound('Email template not found');
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Template Versions & Rollback
// ---------------------------------------------------------------------------

export async function listTemplateVersions(
  templateId: string,
  tenantId: string,
): Promise<EmailTemplateVersion[]> {
  await getTemplate(templateId, tenantId);
  return repo.findTemplateVersions(templateId, tenantId);
}

export async function rollbackTemplateVersion(
  templateId: string,
  versionNumber: number,
  tenantId: string,
  userId: string,
): Promise<EmailTemplate> {
  const current = await getTemplate(templateId, tenantId);
  const targetVersion = await repo.findTemplateVersionByNumber(templateId, versionNumber, tenantId);

  if (!targetVersion) {
    throw AppError.notFound(`Version ${versionNumber} not found for this template`);
  }

  // Snapshot current state
  await repo.createTemplateVersion({
    tenantId,
    templateId: current.id,
    version: current.currentVersion,
    subject: current.subject,
    htmlContent: current.htmlContent,
    designJson: current.designJson,
    variables: current.variables,
    createdById: userId,
  });

  const nextVersion = current.currentVersion + 1;

  const restored = await repo.updateTemplate(templateId, tenantId, {
    subject: targetVersion.subject,
    htmlContent: targetVersion.htmlContent,
    designJson: targetVersion.designJson,
    variables: targetVersion.variables,
    currentVersion: nextVersion,
  });

  if (!restored) {
    throw AppError.notFound('Failed to restore email template version');
  }
  return restored;
}

export const rollbackVersion = rollbackTemplateVersion;

// ---------------------------------------------------------------------------
// Test Send with Abuse Prevention & Member Restriction
// ---------------------------------------------------------------------------

export async function testSendTemplate(
  id: string,
  tenantId: string,
  caller: { id: string; email?: string },
  data: TestSendEmailTemplateDto,
): Promise<{ success: boolean; message: string; renderedSubject: string }> {
  const targetEmail = data.to.toLowerCase().trim();

  // 1. Recipient security check: only caller's email or active members in the tenant
  let callerEmail = caller.email?.toLowerCase()?.trim();
  if (!callerEmail) {
    const [u] = await primaryDbHandle()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, caller.id))
      .limit(1);
    callerEmail = u?.email?.toLowerCase()?.trim();
  }

  const isCaller = !!callerEmail && targetEmail === callerEmail;
  if (!isCaller) {
    const [member] = await tenantDb()
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .innerJoin(users, eq(tenantMembers.userId, users.id))
      .where(
        and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.status, 'ACTIVE'),
          ilike(users.email, targetEmail),
        ),
      )
      .limit(1);

    if (!member) {
      throw AppError.forbidden(
        'Test emails can only be sent to your own verified email or active members of this workspace',
      );
    }
  }

  // 2. Daily rate limit per tenant + user
  const rateLimitKey = `rate:email-test-send:${tenantId}:${caller.id}`;
  const currentCount = await redis.incr(rateLimitKey);
  if (currentCount === 1) {
    await redis.expire(rateLimitKey, 86400); // 24 hours
  }
  if (currentCount > MAX_TEST_SENDS_PER_DAY) {
    throw AppError.tooManyRequests(
      `Daily test email limit reached (${MAX_TEST_SENDS_PER_DAY}/day). Try again tomorrow.`,
    );
  }

  const template = await getTemplate(id, tenantId);

  const renderedSubject = `[TEST] ${renderVariables(template.subject, data.variables || {})}`;
  const renderedHtml = renderVariables(template.htmlContent, data.variables || {});

  const sendResult = await sendEmail({
    to: targetEmail,
    subject: renderedSubject,
    html: renderedHtml,
    tenantId,
    templateId: template.id,
    templateSlug: template.slug,
    fromName: template.senderName ?? undefined,
    fromEmail: template.fromEmail ?? undefined,
    replyTo: template.replyTo ?? undefined,
    relatedEntityType: 'EmailTemplate',
    relatedEntityId: template.id,
  });

  if (sendResult.skippedSuppressed) {
    throw AppError.badRequest(
      `Recipient ${targetEmail} is on the suppression list (bounced or unsubscribed) and cannot receive emails`,
    );
  }

  await logSecurityEvent({
    tenantId,
    userId: caller.id,
    actorType: 'USER',
    action: 'EMAIL_TEMPLATE_TEST_SEND',
    entityType: 'EmailTemplate',
    entityId: template.id,
    metadata: {
      recipient: targetEmail,
      templateSlug: template.slug,
      currentDailyCount: currentCount,
    },
  });

  return {
    success: true,
    message: `Test email sent to ${targetEmail}`,
    renderedSubject,
  };
}

// ---------------------------------------------------------------------------
// Delivery Logs & Messages
// ---------------------------------------------------------------------------

export async function listDeliveryLogs(
  tenantId: string,
  options: Partial<ListDeliveryLogsQueryDto> = {},
) {
  return repo.findEmailMessagesByTenant(tenantId, options);
}

export async function getDeliveryLogById(id: string, tenantId: string): Promise<EmailMessage> {
  const message = await repo.findEmailMessageById(id, tenantId);
  if (!message) {
    throw AppError.notFound('Email delivery message record not found');
  }
  return message;
}

// ---------------------------------------------------------------------------
// Email Suppressions
// ---------------------------------------------------------------------------

export async function listSuppressions(
  tenantId: string,
  options: Partial<ListSuppressionsQueryDto> = {},
) {
  return repo.findSuppressionsByTenant(tenantId, options);
}

export async function createSuppression(
  tenantId: string,
  data: CreateSuppressionDto,
): Promise<EmailSuppression> {
  return repo.createSuppression({
    tenantId,
    email: data.email,
    reason: data.reason,
    details: data.details,
  });
}

export async function deleteSuppression(
  id: string,
  tenantId: string,
): Promise<{ success: boolean }> {
  const deleted = await repo.deleteSuppression(id, tenantId);
  if (!deleted) {
    throw AppError.notFound('Suppression entry not found');
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Bounce & Complaint Webhooks (AWS SES / SMTP Provider)
// ---------------------------------------------------------------------------

export function verifyBounceWebhookAuth(
  payload: BounceWebhookDto,
  headers?: IncomingHttpHeaders,
): void {
  // Validate SNS message type if specified
  if (
    payload.Type &&
    payload.Type !== 'Notification' &&
    payload.Type !== 'SubscriptionConfirmation'
  ) {
    throw AppError.badRequest(`Unsupported SNS message type: ${payload.Type}`);
  }

  const secretHeader =
    (headers?.['x-webhook-secret'] as string | undefined) ||
    (headers?.['x-bounce-secret'] as string | undefined) ||
    (headers?.['authorization']?.startsWith('Bearer ')
      ? headers['authorization'].slice(7).trim()
      : undefined);

  const configuredSecret = env.EMAIL_BOUNCE_WEBHOOK_SECRET;

  // 1. Shared Secret Authentication (constant-time comparison)
  if (secretHeader && configuredSecret) {
    if (safeEqual(secretHeader, configuredSecret)) {
      return; // Authorized via valid shared secret
    }
    throw AppError.forbidden('Invalid webhook secret');
  }

  // 2. AWS SNS Message Verification
  if (payload.Type) {
    // Verify TopicArn if configured
    if (env.SES_NOTIFICATION_TOPIC_ARN && payload.TopicArn) {
      if (!safeEqual(payload.TopicArn, env.SES_NOTIFICATION_TOPIC_ARN)) {
        throw AppError.forbidden('Invalid SNS TopicArn');
      }
    }

    // Verify SigningCertURL if signature is present
    if (payload.Signature && payload.SigningCertURL) {
      const isValidCertUrl = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\//i.test(
        payload.SigningCertURL,
      );
      if (!isValidCertUrl) {
        throw AppError.forbidden('Invalid SNS SigningCertURL');
      }
      return; // Authorized via SNS signature envelope
    }

    if (configuredSecret) {
      throw AppError.unauthorized('Webhook shared secret header is required');
    }

    if (payload.TopicArn) {
      return;
    }
  }

  throw AppError.unauthorized(
    'Unauthenticated webhook request: valid signature or shared secret required',
  );
}

export async function handleBounceWebhook(
  payload: BounceWebhookDto,
  headers?: IncomingHttpHeaders,
): Promise<{ processed: number }> {
  verifyBounceWebhookAuth(payload, headers);

  if (payload.Type === 'SubscriptionConfirmation') {
    logger.info(
      { topicArn: payload.TopicArn, subscribeUrl: payload.SubscribeURL },
      'SNS Subscription confirmation received',
    );
    return { processed: 0 };
  }

  // 1. AWS SNS Notification format parsing
  let body: any = payload;
  if (payload.Type === 'Notification' && typeof payload.Message === 'string') {
    try {
      body = JSON.parse(payload.Message);
    } catch {
      body = payload;
    }
  }

  const notificationType = body.notificationType || body.eventType || payload.notificationType;

  // Reject unknown notification types if Type is Notification
  if (
    payload.Type === 'Notification' &&
    notificationType !== 'Bounce' &&
    notificationType !== 'Complaint'
  ) {
    logger.warn({ notificationType }, 'Unsupported SNS notificationType; ignoring');
    return { processed: 0 };
  }

  let processed = 0;

  // Handle AWS SES Bounces
  if (notificationType === 'Bounce' && body.bounce?.bouncedRecipients) {
    const recipients = body.bounce.bouncedRecipients as Array<{
      emailAddress: string;
      diagnosticCode?: string;
    }>;
    for (const r of recipients) {
      if (r?.emailAddress) {
        const cleanEmail = r.emailAddress.toLowerCase().trim();
        // NEVER trust payload.tenantId; ALWAYS resolve from stored emailMessages
        const [recent] = await tenantDb()
          .select({ tenantId: emailMessages.tenantId, id: emailMessages.id })
          .from(emailMessages)
          .where(eq(emailMessages.to, cleanEmail))
          .orderBy(desc(emailMessages.createdAt))
          .limit(1);

        const targetTenantId = recent?.tenantId;
        if (recent?.id) {
          await repo.updateEmailMessageStatus(recent.id, 'BOUNCED', {
            lastError: r.diagnosticCode ?? 'SES Bounce reported',
          });
        }

        if (targetTenantId) {
          await repo.createSuppression({
            tenantId: targetTenantId,
            email: cleanEmail,
            reason: 'BOUNCE',
            details: r.diagnosticCode || 'SES Hard Bounce',
          });
          processed++;
        }
      }
    }
  }

  // Handle AWS SES Complaints
  if (notificationType === 'Complaint' && body.complaint?.complainedRecipients) {
    const recipients = body.complaint.complainedRecipients as Array<{ emailAddress: string }>;
    for (const r of recipients) {
      if (r?.emailAddress) {
        const cleanEmail = r.emailAddress.toLowerCase().trim();
        // NEVER trust payload.tenantId; ALWAYS resolve from stored emailMessages
        const [recent] = await tenantDb()
          .select({ tenantId: emailMessages.tenantId, id: emailMessages.id })
          .from(emailMessages)
          .where(eq(emailMessages.to, cleanEmail))
          .orderBy(desc(emailMessages.createdAt))
          .limit(1);

        const targetTenantId = recent?.tenantId;
        if (recent?.id) {
          await repo.updateEmailMessageStatus(recent.id, 'COMPLAINED', {
            lastError: 'SES Recipient Complaint',
          });
        }

        if (targetTenantId) {
          await repo.createSuppression({
            tenantId: targetTenantId,
            email: cleanEmail,
            reason: 'COMPLAINT',
            details: 'Recipient spam complaint received',
          });
          processed++;
        }
      }
    }
  }

  // Handle Direct Webhook Payload (e.g. from Custom SMTP or Manual testing)
  if (payload.email) {
    const cleanEmail = payload.email.toLowerCase().trim();
    const reason =
      payload.reason === 'COMPLAINT' || payload.reason === 'UNSUBSCRIBE'
        ? (payload.reason as any)
        : 'BOUNCE';

    // NEVER trust payload.tenantId; ALWAYS resolve from stored emailMessages
    const [recent] = await tenantDb()
      .select({ tenantId: emailMessages.tenantId, id: emailMessages.id })
      .from(emailMessages)
      .where(eq(emailMessages.to, cleanEmail))
      .orderBy(desc(emailMessages.createdAt))
      .limit(1);

    const targetTenantId = recent?.tenantId;
    if (recent?.id) {
      await repo.updateEmailMessageStatus(
        recent.id,
        reason === 'COMPLAINT' ? 'COMPLAINED' : 'BOUNCED',
        {
          lastError: payload.details ?? 'Webhook bounce notification',
        },
      );
    }

    if (targetTenantId) {
      await repo.createSuppression({
        tenantId: targetTenantId,
        email: cleanEmail,
        reason,
        details: payload.details ?? 'Webhook bounce notification',
      });
      processed++;
    }
  }

  return { processed };
}
