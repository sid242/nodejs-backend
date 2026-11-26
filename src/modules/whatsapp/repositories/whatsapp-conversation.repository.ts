import { and, desc, eq } from 'drizzle-orm';

import {
  whatsAppConversations,
  type NewWhatsAppConversationRecord,
  type WhatsAppConversationRecord,
} from '@/db/schema';
import type { WhatsAppConversationStatus } from '@/db/schema/enums';
import { tenantDb } from '@/db/tenancy/context';

export async function findConversationByContactAndPhone(
  tenantId: string,
  phoneNumberId: string,
  contactId: string,
): Promise<WhatsAppConversationRecord | undefined> {
  const [conv] = await tenantDb()
    .select()
    .from(whatsAppConversations)
    .where(
      and(
        eq(whatsAppConversations.tenantId, tenantId),
        eq(whatsAppConversations.phoneNumberId, phoneNumberId),
        eq(whatsAppConversations.contactId, contactId),
      ),
    )
    .limit(1);
  return conv;
}

export async function findConversationById(
  tenantId: string,
  id: string,
): Promise<WhatsAppConversationRecord | undefined> {
  const [conv] = await tenantDb()
    .select()
    .from(whatsAppConversations)
    .where(and(eq(whatsAppConversations.id, id), eq(whatsAppConversations.tenantId, tenantId)))
    .limit(1);
  return conv;
}

export async function listConversations(
  tenantId: string,
  status?: string,
  limit = 50,
  offset = 0,
): Promise<WhatsAppConversationRecord[]> {
  const conditions = [eq(whatsAppConversations.tenantId, tenantId)];
  if (status) {
    conditions.push(eq(whatsAppConversations.status, status as WhatsAppConversationStatus));
  }

  return tenantDb()
    .select()
    .from(whatsAppConversations)
    .where(and(...conditions))
    .orderBy(desc(whatsAppConversations.lastMessageAt))
    .limit(limit)
    .offset(offset);
}

export async function createConversation(
  data: NewWhatsAppConversationRecord,
): Promise<WhatsAppConversationRecord> {
  const [created] = await tenantDb().insert(whatsAppConversations).values(data).returning();
  return created!;
}

export async function updateConversation(
  tenantId: string,
  id: string,
  patch: Partial<NewWhatsAppConversationRecord>,
): Promise<WhatsAppConversationRecord | undefined> {
  const [updated] = await tenantDb()
    .update(whatsAppConversations)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(and(eq(whatsAppConversations.id, id), eq(whatsAppConversations.tenantId, tenantId)))
    .returning();
  return updated;
}
