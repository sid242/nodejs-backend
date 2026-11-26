import { and, desc, eq } from 'drizzle-orm';

import {
  whatsAppMessages,
  type NewWhatsAppMessageRecord,
  type WhatsAppMessageRecord,
} from '@/db/schema';
import { tenantDb } from '@/db/tenancy/context';

export interface ListMessagesFilters {
  tenantId: string;
  contactId?: string;
  conversationId?: string;
  phoneNumberId?: string;
  limit?: number;
  offset?: number;
}

export async function listMessages(filters: ListMessagesFilters): Promise<WhatsAppMessageRecord[]> {
  const conditions = [eq(whatsAppMessages.tenantId, filters.tenantId)];

  if (filters.contactId) {
    conditions.push(eq(whatsAppMessages.contactId, filters.contactId));
  }
  if (filters.conversationId) {
    conditions.push(eq(whatsAppMessages.conversationId, filters.conversationId));
  }
  if (filters.phoneNumberId) {
    conditions.push(eq(whatsAppMessages.phoneNumberId, filters.phoneNumberId));
  }

  return tenantDb()
    .select()
    .from(whatsAppMessages)
    .where(and(...conditions))
    .orderBy(desc(whatsAppMessages.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);
}

export async function findMessageById(
  tenantId: string,
  id: string,
): Promise<WhatsAppMessageRecord | undefined> {
  const [message] = await tenantDb()
    .select()
    .from(whatsAppMessages)
    .where(and(eq(whatsAppMessages.id, id), eq(whatsAppMessages.tenantId, tenantId)))
    .limit(1);
  return message;
}

export async function findMessageByProviderId(
  tenantId: string,
  providerMessageId: string,
): Promise<WhatsAppMessageRecord | undefined> {
  const [message] = await tenantDb()
    .select()
    .from(whatsAppMessages)
    .where(
      and(
        eq(whatsAppMessages.tenantId, tenantId),
        eq(whatsAppMessages.providerMessageId, providerMessageId),
      ),
    )
    .limit(1);
  return message;
}

export async function findMessageByIdempotencyKey(
  tenantId: string,
  idempotencyKey: string,
): Promise<WhatsAppMessageRecord | undefined> {
  const [message] = await tenantDb()
    .select()
    .from(whatsAppMessages)
    .where(
      and(
        eq(whatsAppMessages.tenantId, tenantId),
        eq(whatsAppMessages.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return message;
}

export async function createMessage(
  data: NewWhatsAppMessageRecord,
): Promise<WhatsAppMessageRecord> {
  const [created] = await tenantDb().insert(whatsAppMessages).values(data).returning();
  return created!;
}

export async function updateMessageStatus(
  tenantId: string,
  messageId: string,
  patch: Partial<NewWhatsAppMessageRecord>,
): Promise<WhatsAppMessageRecord | undefined> {
  const [updated] = await tenantDb()
    .update(whatsAppMessages)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(and(eq(whatsAppMessages.id, messageId), eq(whatsAppMessages.tenantId, tenantId)))
    .returning();
  return updated;
}
