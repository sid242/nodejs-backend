import { and, desc, eq, sql } from 'drizzle-orm';

import {
  whatsAppCampaignRecipients,
  whatsAppCampaigns,
  type NewWhatsAppCampaignRecipientRecord,
  type NewWhatsAppCampaignRecord,
  type WhatsAppCampaignRecipientRecord,
  type WhatsAppCampaignRecord,
} from '@/db/schema';
import { tenantDb } from '@/db/tenancy/context';

export async function listCampaigns(
  tenantId: string,
  limit = 50,
  offset = 0,
): Promise<WhatsAppCampaignRecord[]> {
  return tenantDb()
    .select()
    .from(whatsAppCampaigns)
    .where(eq(whatsAppCampaigns.tenantId, tenantId))
    .orderBy(desc(whatsAppCampaigns.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function findCampaignById(
  tenantId: string,
  id: string,
): Promise<WhatsAppCampaignRecord | undefined> {
  const [campaign] = await tenantDb()
    .select()
    .from(whatsAppCampaigns)
    .where(and(eq(whatsAppCampaigns.id, id), eq(whatsAppCampaigns.tenantId, tenantId)))
    .limit(1);
  return campaign;
}

export async function createCampaign(
  data: NewWhatsAppCampaignRecord,
): Promise<WhatsAppCampaignRecord> {
  const [created] = await tenantDb().insert(whatsAppCampaigns).values(data).returning();
  return created!;
}

export async function updateCampaign(
  tenantId: string,
  id: string,
  patch: Partial<NewWhatsAppCampaignRecord>,
): Promise<WhatsAppCampaignRecord | undefined> {
  const [updated] = await tenantDb()
    .update(whatsAppCampaigns)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(and(eq(whatsAppCampaigns.id, id), eq(whatsAppCampaigns.tenantId, tenantId)))
    .returning();
  return updated;
}

export async function addCampaignRecipients(
  recipients: NewWhatsAppCampaignRecipientRecord[],
): Promise<void> {
  if (recipients.length === 0) return;
  await tenantDb().insert(whatsAppCampaignRecipients).values(recipients);
}

export async function listCampaignRecipients(
  tenantId: string,
  campaignId: string,
  limit = 100,
  offset = 0,
): Promise<WhatsAppCampaignRecipientRecord[]> {
  return tenantDb()
    .select()
    .from(whatsAppCampaignRecipients)
    .where(
      and(
        eq(whatsAppCampaignRecipients.tenantId, tenantId),
        eq(whatsAppCampaignRecipients.campaignId, campaignId),
      ),
    )
    .limit(limit)
    .offset(offset);
}

export async function listPendingCampaignRecipients(
  tenantId: string,
  campaignId: string,
  limit = 200,
): Promise<WhatsAppCampaignRecipientRecord[]> {
  return tenantDb()
    .select()
    .from(whatsAppCampaignRecipients)
    .where(
      and(
        eq(whatsAppCampaignRecipients.tenantId, tenantId),
        eq(whatsAppCampaignRecipients.campaignId, campaignId),
        eq(whatsAppCampaignRecipients.status, 'PENDING'),
      ),
    )
    .limit(limit);
}

export async function updateCampaignRecipient(
  tenantId: string,
  recipientId: string,
  patch: Partial<NewWhatsAppCampaignRecipientRecord>,
): Promise<WhatsAppCampaignRecipientRecord | undefined> {
  const [updated] = await tenantDb()
    .update(whatsAppCampaignRecipients)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsAppCampaignRecipients.id, recipientId),
        eq(whatsAppCampaignRecipients.tenantId, tenantId),
      ),
    )
    .returning();
  return updated;
}

export async function getCampaignRecipientSummary(
  tenantId: string,
  campaignId: string,
): Promise<{
  total: number;
  pending: number;
  sent: number;
  failed: number;
  suppressed: number;
}> {
  const rows = await tenantDb()
    .select({
      status: whatsAppCampaignRecipients.status,
      count: sql<number>`count(*)::int`,
    })
    .from(whatsAppCampaignRecipients)
    .where(
      and(
        eq(whatsAppCampaignRecipients.tenantId, tenantId),
        eq(whatsAppCampaignRecipients.campaignId, campaignId),
      ),
    )
    .groupBy(whatsAppCampaignRecipients.status);

  const summary = { total: 0, pending: 0, sent: 0, failed: 0, suppressed: 0 };
  for (const row of rows) {
    summary.total += row.count;
    if (row.status === 'PENDING') summary.pending += row.count;
    else if (row.status === 'SENT') summary.sent += row.count;
    else if (row.status === 'FAILED') summary.failed += row.count;
    else if (row.status === 'SUPPRESSED') summary.suppressed += row.count;
  }
  return summary;
}

export async function incrementCampaignCounters(
  tenantId: string,
  campaignId: string,
  type: 'accepted' | 'delivered' | 'read' | 'failed',
): Promise<void> {
  const columnMap = {
    accepted: whatsAppCampaigns.acceptedCount,
    delivered: whatsAppCampaigns.deliveredCount,
    read: whatsAppCampaigns.readCount,
    failed: whatsAppCampaigns.failedCount,
  };

  const col = columnMap[type];
  if (!col) return;

  await tenantDb()
    .update(whatsAppCampaigns)
    .set({
      [type === 'accepted'
        ? 'acceptedCount'
        : type === 'delivered'
          ? 'deliveredCount'
          : type === 'read'
            ? 'readCount'
            : 'failedCount']: sql`${col} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(whatsAppCampaigns.id, campaignId), eq(whatsAppCampaigns.tenantId, tenantId)));
}
