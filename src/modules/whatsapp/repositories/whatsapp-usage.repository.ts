import { desc, eq, sql } from 'drizzle-orm';

import {
  whatsAppUsageRecords,
  type NewWhatsAppUsageRecord,
  type WhatsAppUsageRecord,
} from '@/db/schema';
import { tenantDb } from '@/db/tenancy/context';

export async function recordUsage(data: NewWhatsAppUsageRecord): Promise<WhatsAppUsageRecord> {
  const [created] = await tenantDb().insert(whatsAppUsageRecords).values(data).returning();
  return created!;
}

export async function getUsageSummary(tenantId: string): Promise<{
  totalMessages: number;
  totalEstimatedCost: string;
  categoryBreakdown: Array<{ category: string; count: number }>;
}> {
  const [totalRes] = await tenantDb()
    .select({
      count: sql<number>`count(*)::int`,
      totalCost: sql<string>`coalesce(sum(${whatsAppUsageRecords.estimatedCost}), 0)::text`,
    })
    .from(whatsAppUsageRecords)
    .where(eq(whatsAppUsageRecords.tenantId, tenantId));

  const categories = await tenantDb()
    .select({
      category: whatsAppUsageRecords.templateCategory,
      count: sql<number>`count(*)::int`,
    })
    .from(whatsAppUsageRecords)
    .where(eq(whatsAppUsageRecords.tenantId, tenantId))
    .groupBy(whatsAppUsageRecords.templateCategory);

  return {
    totalMessages: totalRes?.count ?? 0,
    totalEstimatedCost: totalRes?.totalCost ?? '0.00',
    categoryBreakdown: categories,
  };
}

export async function listUsageRecords(
  tenantId: string,
  limit = 50,
  offset = 0,
): Promise<WhatsAppUsageRecord[]> {
  return tenantDb()
    .select()
    .from(whatsAppUsageRecords)
    .where(eq(whatsAppUsageRecords.tenantId, tenantId))
    .orderBy(desc(whatsAppUsageRecords.messageTimestamp))
    .limit(limit)
    .offset(offset);
}
