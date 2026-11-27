import { asc, desc, eq, sql } from 'drizzle-orm';

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
  estimatedCostByCurrency: Array<{ currency: string; estimatedCost: string }>;
  categoryBreakdown: Array<{ category: string; count: number }>;
}> {
  const costs = await tenantDb()
    .select({
      currency: whatsAppUsageRecords.currency,
      estimatedCost: sql<string>`sum(${whatsAppUsageRecords.estimatedCost})::text`,
      totalMessages: sql<number>`sum(count(*)) over ()::int`,
      legacyTotalCost: sql<string>`sum(sum(${whatsAppUsageRecords.estimatedCost})) over ()::text`,
    })
    .from(whatsAppUsageRecords)
    .where(eq(whatsAppUsageRecords.tenantId, tenantId))
    .groupBy(whatsAppUsageRecords.currency)
    .orderBy(asc(whatsAppUsageRecords.currency));

  const categories = await tenantDb()
    .select({
      category: whatsAppUsageRecords.templateCategory,
      count: sql<number>`count(*)::int`,
    })
    .from(whatsAppUsageRecords)
    .where(eq(whatsAppUsageRecords.tenantId, tenantId))
    .groupBy(whatsAppUsageRecords.templateCategory);

  return {
    totalMessages: costs[0]?.totalMessages ?? 0,
    // Retain the original field for older clients. New clients use the currency breakdown.
    totalEstimatedCost: costs[0]?.legacyTotalCost ?? '0.00',
    estimatedCostByCurrency: costs.map(({ currency, estimatedCost }) => ({
      currency,
      estimatedCost,
    })),
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
