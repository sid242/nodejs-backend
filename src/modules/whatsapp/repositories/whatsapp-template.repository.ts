import { and, desc, eq, ilike } from 'drizzle-orm';

import {
  whatsAppTemplates,
  type NewWhatsAppTemplateRecord,
  type WhatsAppTemplateCategory,
  type WhatsAppTemplateRecord,
  type WhatsAppTemplateStatus,
} from '@/db/schema';
import { tenantDb } from '@/db/tenancy/context';

export interface ListTemplatesFilters {
  tenantId: string;
  category?: WhatsAppTemplateCategory;
  status?: WhatsAppTemplateStatus;
  language?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listTemplates(
  filters: ListTemplatesFilters,
): Promise<{ items: WhatsAppTemplateRecord[]; total: number }> {
  const conditions = [eq(whatsAppTemplates.tenantId, filters.tenantId)];

  if (filters.category) {
    conditions.push(eq(whatsAppTemplates.category, filters.category));
  }
  if (filters.status) {
    conditions.push(eq(whatsAppTemplates.status, filters.status));
  }
  if (filters.language) {
    conditions.push(eq(whatsAppTemplates.language, filters.language));
  }
  if (filters.search) {
    conditions.push(ilike(whatsAppTemplates.name, `%${filters.search}%`));
  }

  const items = await tenantDb()
    .select()
    .from(whatsAppTemplates)
    .where(and(...conditions))
    .orderBy(desc(whatsAppTemplates.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  return { items, total: items.length };
}

export async function findTemplateById(
  tenantId: string,
  id: string,
): Promise<WhatsAppTemplateRecord | undefined> {
  const [template] = await tenantDb()
    .select()
    .from(whatsAppTemplates)
    .where(and(eq(whatsAppTemplates.id, id), eq(whatsAppTemplates.tenantId, tenantId)))
    .limit(1);
  return template;
}

export async function findTemplateByName(
  tenantId: string,
  name: string,
  language = 'en',
): Promise<WhatsAppTemplateRecord | undefined> {
  const [template] = await tenantDb()
    .select()
    .from(whatsAppTemplates)
    .where(
      and(
        eq(whatsAppTemplates.tenantId, tenantId),
        eq(whatsAppTemplates.name, name),
        eq(whatsAppTemplates.language, language),
      ),
    )
    .limit(1);
  return template;
}

export async function createTemplate(
  data: NewWhatsAppTemplateRecord,
): Promise<WhatsAppTemplateRecord> {
  const [created] = await tenantDb().insert(whatsAppTemplates).values(data).returning();
  return created!;
}

export async function updateTemplate(
  tenantId: string,
  id: string,
  patch: Partial<NewWhatsAppTemplateRecord>,
): Promise<WhatsAppTemplateRecord | undefined> {
  const [updated] = await tenantDb()
    .update(whatsAppTemplates)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(and(eq(whatsAppTemplates.id, id), eq(whatsAppTemplates.tenantId, tenantId)))
    .returning();
  return updated;
}

export async function deleteTemplate(tenantId: string, id: string): Promise<boolean> {
  const [deleted] = await tenantDb()
    .delete(whatsAppTemplates)
    .where(and(eq(whatsAppTemplates.id, id), eq(whatsAppTemplates.tenantId, tenantId)))
    .returning();
  return !!deleted;
}
