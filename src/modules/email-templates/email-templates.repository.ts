import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';

import { db } from '@/config/db';
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
): Promise<{ templates: EmailTemplate[]; total: number; page: number; limit: number }> {
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
    db
      .select()
      .from(emailTemplates)
      .where(whereClause)
      .orderBy(desc(emailTemplates.createdAt))
      .limit(limit)
      .offset(offset),
    db
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
): Promise<EmailTemplate | undefined> {
  const [template] = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.tenantId, tenantId)))
    .limit(1);
  return template;
}

export async function findTemplateBySlug(
  slug: string,
  tenantId: string,
): Promise<EmailTemplate | undefined> {
  const [template] = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.slug, slug), eq(emailTemplates.tenantId, tenantId)))
    .limit(1);
  return template;
}

export async function createTemplate(data: NewEmailTemplate): Promise<EmailTemplate> {
  const [created] = await db.insert(emailTemplates).values(data).returning();
  return created!;
}

export async function updateTemplate(
  id: string,
  tenantId: string,
  data: Partial<NewEmailTemplate>,
): Promise<EmailTemplate | undefined> {
  const [updated] = await db
    .update(emailTemplates)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.tenantId, tenantId)))
    .returning();
  return updated;
}

export async function deleteTemplate(id: string, tenantId: string): Promise<boolean> {
  const result = await db
    .delete(emailTemplates)
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.tenantId, tenantId)))
    .returning({ id: emailTemplates.id });
  return result.length > 0;
}
