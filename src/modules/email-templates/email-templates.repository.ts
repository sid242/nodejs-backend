import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';

import type { DbExecutor } from '@/config/db';
import {
  emailMessages,
  emailSuppressions,
  emailTemplates,
  emailTemplateVersions,
  type EmailMessage,
  type EmailSuppression,
  type EmailTemplate,
  type EmailTemplateVersion,
  type NewEmailMessage,
  type NewEmailSuppression,
  type NewEmailTemplate,
  type NewEmailTemplateVersion,
} from '@/db/schema/index';
import { assertTenantScope, tenantDb } from '@/db/tenancy/context';

export interface FindEmailTemplatesOptions {
  page?: number;
  limit?: number;
  search?: string;
  category?: 'MARKETING' | 'TRANSACTIONAL' | 'NOTIFICATION' | 'CUSTOM';
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  locale?: string;
}

export async function findTemplatesByTenant(
  tenantId: string,
  options: FindEmailTemplatesOptions = {},
  executor: DbExecutor = tenantDb(),
): Promise<{ templates: EmailTemplate[]; total: number; page: number; limit: number }> {
  assertTenantScope(tenantId);
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions = [eq(emailTemplates.tenantId, tenantId)];

  if (options.category) {
    conditions.push(eq(emailTemplates.category, options.category));
  }

  if (options.status) {
    conditions.push(eq(emailTemplates.status, options.status));
  }

  if (options.locale) {
    conditions.push(eq(emailTemplates.locale, options.locale));
  }

  if (options.search) {
    const searchPattern = `%${options.search}%`;
    conditions.push(
      or(
        ilike(emailTemplates.name, searchPattern),
        ilike(emailTemplates.subject, searchPattern),
        ilike(emailTemplates.slug, searchPattern),
      )!,
    );
  }

  const whereClause = and(...conditions);

  const [templates, countResult] = await Promise.all([
    executor
      .select()
      .from(emailTemplates)
      .where(whereClause)
      .orderBy(desc(emailTemplates.createdAt))
      .limit(limit)
      .offset(offset),
    executor
      .select({ count: sql<number>`count(*)::int` })
      .from(emailTemplates)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;
  return { templates, total, page, limit };
}

export async function findTemplateById(
  id: string,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<EmailTemplate | undefined> {
  assertTenantScope(tenantId);
  const [template] = await executor
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.tenantId, tenantId)))
    .limit(1);
  return template;
}

export async function findTemplateBySlug(
  slug: string,
  tenantId: string,
  locale = 'en',
  executor: DbExecutor = tenantDb(),
): Promise<EmailTemplate | undefined> {
  assertTenantScope(tenantId);
  const [template] = await executor
    .select()
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.slug, slug),
        eq(emailTemplates.locale, locale),
        eq(emailTemplates.tenantId, tenantId),
      ),
    )
    .limit(1);
  return template;
}

export async function createTemplate(
  data: NewEmailTemplate,
  executor: DbExecutor = tenantDb(),
): Promise<EmailTemplate> {
  assertTenantScope(data.tenantId);
  const [created] = await executor.insert(emailTemplates).values(data).returning();
  return created!;
}

export async function updateTemplate(
  id: string,
  tenantId: string,
  data: Partial<NewEmailTemplate>,
  executor: DbExecutor = tenantDb(),
): Promise<EmailTemplate | undefined> {
  assertTenantScope(tenantId);
  const [updated] = await executor
    .update(emailTemplates)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.tenantId, tenantId)))
    .returning();
  return updated;
}

export async function deleteTemplate(
  id: string,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<boolean> {
  assertTenantScope(tenantId);
  const result = await executor
    .delete(emailTemplates)
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.tenantId, tenantId)))
    .returning({ id: emailTemplates.id });
  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Template Versions
// ---------------------------------------------------------------------------

export async function createTemplateVersion(
  data: NewEmailTemplateVersion,
  executor: DbExecutor = tenantDb(),
): Promise<EmailTemplateVersion> {
  assertTenantScope(data.tenantId);
  const [created] = await executor.insert(emailTemplateVersions).values(data).returning();
  return created!;
}

export async function findTemplateVersions(
  templateId: string,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<EmailTemplateVersion[]> {
  assertTenantScope(tenantId);
  return executor
    .select()
    .from(emailTemplateVersions)
    .where(
      and(
        eq(emailTemplateVersions.templateId, templateId),
        eq(emailTemplateVersions.tenantId, tenantId),
      ),
    )
    .orderBy(desc(emailTemplateVersions.version));
}

export async function findTemplateVersionByNumber(
  templateId: string,
  versionNumber: number,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<EmailTemplateVersion | undefined> {
  assertTenantScope(tenantId);
  const [version] = await executor
    .select()
    .from(emailTemplateVersions)
    .where(
      and(
        eq(emailTemplateVersions.templateId, templateId),
        eq(emailTemplateVersions.version, versionNumber),
        eq(emailTemplateVersions.tenantId, tenantId),
      ),
    )
    .limit(1);
  return version;
}

// ---------------------------------------------------------------------------
// Email Delivery Messages
// ---------------------------------------------------------------------------

export interface FindEmailMessagesOptions {
  page?: number;
  limit?: number;
  status?: string;
  to?: string;
  search?: string;
}

export async function recordEmailMessage(
  data: NewEmailMessage,
  executor: DbExecutor = tenantDb(),
): Promise<EmailMessage> {
  assertTenantScope(data.tenantId);
  const [message] = await executor.insert(emailMessages).values(data).returning();
  return message!;
}

export async function updateEmailMessageStatus(
  id: string,
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'FAILED',
  meta: {
    providerMessageId?: string;
    lastError?: string;
    sentAt?: Date;
    deliveredAt?: Date;
    openedAt?: Date;
  } = {},
  executor: DbExecutor = tenantDb(),
): Promise<EmailMessage | undefined> {
  const [updated] = await executor
    .update(emailMessages)
    .set({
      status,
      ...(meta.providerMessageId ? { providerMessageId: meta.providerMessageId } : {}),
      ...(meta.lastError !== undefined ? { lastError: meta.lastError } : {}),
      ...(meta.sentAt ? { sentAt: meta.sentAt } : {}),
      ...(meta.deliveredAt ? { deliveredAt: meta.deliveredAt } : {}),
      ...(meta.openedAt ? { openedAt: meta.openedAt } : {}),
    })
    .where(eq(emailMessages.id, id))
    .returning();
  return updated;
}

export async function findEmailMessagesByTenant(
  tenantId: string,
  options: FindEmailMessagesOptions = {},
  executor: DbExecutor = tenantDb(),
): Promise<{ messages: EmailMessage[]; total: number; page: number; limit: number }> {
  assertTenantScope(tenantId);
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions = [eq(emailMessages.tenantId, tenantId)];

  if (options.status) {
    conditions.push(eq(emailMessages.status, options.status as any));
  }

  if (options.to) {
    conditions.push(eq(emailMessages.to, options.to.toLowerCase().trim()));
  }

  if (options.search) {
    const searchPattern = `%${options.search}%`;
    conditions.push(
      or(
        ilike(emailMessages.to, searchPattern),
        ilike(emailMessages.subject, searchPattern),
        ilike(emailMessages.templateSlug, searchPattern),
      )!,
    );
  }

  const whereClause = and(...conditions);

  const [messages, countResult] = await Promise.all([
    executor
      .select()
      .from(emailMessages)
      .where(whereClause)
      .orderBy(desc(emailMessages.createdAt))
      .limit(limit)
      .offset(offset),
    executor
      .select({ count: sql<number>`count(*)::int` })
      .from(emailMessages)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;
  return { messages, total, page, limit };
}

export async function findEmailMessageById(
  id: string,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<EmailMessage | undefined> {
  assertTenantScope(tenantId);
  const [message] = await executor
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.id, id), eq(emailMessages.tenantId, tenantId)))
    .limit(1);
  return message;
}

// ---------------------------------------------------------------------------
// Email Suppressions
// ---------------------------------------------------------------------------

export interface FindEmailSuppressionsOptions {
  page?: number;
  limit?: number;
  search?: string;
  reason?: 'BOUNCE' | 'COMPLAINT' | 'UNSUBSCRIBE' | 'MANUAL';
}

export async function findSuppression(
  tenantId: string,
  email: string,
  executor: DbExecutor = tenantDb(),
): Promise<EmailSuppression | undefined> {
  assertTenantScope(tenantId);
  const [suppression] = await executor
    .select()
    .from(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.tenantId, tenantId),
        eq(emailSuppressions.email, email.toLowerCase().trim()),
      ),
    )
    .limit(1);
  return suppression;
}

export async function isEmailSuppressed(
  tenantId: string,
  email: string,
  executor: DbExecutor = tenantDb(),
): Promise<boolean> {
  const record = await findSuppression(tenantId, email, executor);
  return !!record;
}

export async function createSuppression(
  data: NewEmailSuppression,
  executor: DbExecutor = tenantDb(),
): Promise<EmailSuppression> {
  assertTenantScope(data.tenantId);
  const [created] = await executor
    .insert(emailSuppressions)
    .values({ ...data, email: data.email.toLowerCase().trim() })
    .onConflictDoUpdate({
      target: [emailSuppressions.tenantId, emailSuppressions.email],
      set: {
        reason: data.reason,
        details: data.details,
      },
    })
    .returning();
  return created!;
}

export async function deleteSuppression(
  id: string,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<boolean> {
  assertTenantScope(tenantId);
  const result = await executor
    .delete(emailSuppressions)
    .where(and(eq(emailSuppressions.id, id), eq(emailSuppressions.tenantId, tenantId)))
    .returning({ id: emailSuppressions.id });
  return result.length > 0;
}

export async function deleteSuppressionByEmail(
  tenantId: string,
  email: string,
  executor: DbExecutor = tenantDb(),
): Promise<boolean> {
  assertTenantScope(tenantId);
  const result = await executor
    .delete(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.tenantId, tenantId),
        eq(emailSuppressions.email, email.toLowerCase().trim()),
      ),
    )
    .returning({ id: emailSuppressions.id });
  return result.length > 0;
}

export async function findSuppressionsByTenant(
  tenantId: string,
  options: FindEmailSuppressionsOptions = {},
  executor: DbExecutor = tenantDb(),
): Promise<{ suppressions: EmailSuppression[]; total: number; page: number; limit: number }> {
  assertTenantScope(tenantId);
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions = [eq(emailSuppressions.tenantId, tenantId)];

  if (options.reason) {
    conditions.push(eq(emailSuppressions.reason, options.reason));
  }

  if (options.search) {
    conditions.push(ilike(emailSuppressions.email, `%${options.search}%`));
  }

  const whereClause = and(...conditions);

  const [suppressions, countResult] = await Promise.all([
    executor
      .select()
      .from(emailSuppressions)
      .where(whereClause)
      .orderBy(desc(emailSuppressions.createdAt))
      .limit(limit)
      .offset(offset),
    executor
      .select({ count: sql<number>`count(*)::int` })
      .from(emailSuppressions)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;
  return { suppressions, total, page, limit };
}
