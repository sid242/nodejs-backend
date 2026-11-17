import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';

import type { DbExecutor } from '@/config/db';
import { assertTenantScope, tenantDb } from '@/db/tenancy/context';
import { emailTemplates, type EmailTemplate, type NewEmailTemplate } from '@/db/schema/index';

export interface FindEmailTemplatesOptions {
  page?: number;
  limit?: number;
  search?: string;
  category?: 'MARKETING' | 'TRANSACTIONAL' | 'NOTIFICATION' | 'CUSTOM';
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
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
  executor: DbExecutor = tenantDb(),
): Promise<EmailTemplate | undefined> {
  assertTenantScope(tenantId);
  const [template] = await executor
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.slug, slug), eq(emailTemplates.tenantId, tenantId)))
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
