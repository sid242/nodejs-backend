import { and, desc, eq, ilike } from 'drizzle-orm';

import {
  whatsAppContactConsents,
  whatsAppContacts,
  type NewWhatsAppContactConsentRecord,
  type NewWhatsAppContactRecord,
  type WhatsAppConsentPurpose,
  type WhatsAppContactConsentRecord,
  type WhatsAppContactRecord,
} from '@/db/schema';
import { tenantDb } from '@/db/tenancy/context';

export async function findContactByPhoneNumber(
  tenantId: string,
  phoneNumber: string,
): Promise<WhatsAppContactRecord | undefined> {
  const [contact] = await tenantDb()
    .select()
    .from(whatsAppContacts)
    .where(
      and(eq(whatsAppContacts.tenantId, tenantId), eq(whatsAppContacts.phoneNumber, phoneNumber)),
    )
    .limit(1);
  return contact;
}

export async function findContactById(
  tenantId: string,
  id: string,
): Promise<WhatsAppContactRecord | undefined> {
  const [contact] = await tenantDb()
    .select()
    .from(whatsAppContacts)
    .where(and(eq(whatsAppContacts.id, id), eq(whatsAppContacts.tenantId, tenantId)))
    .limit(1);
  return contact;
}

export async function createContact(
  data: NewWhatsAppContactRecord,
): Promise<WhatsAppContactRecord> {
  const [created] = await tenantDb().insert(whatsAppContacts).values(data).returning();
  return created!;
}

export async function listContacts(
  tenantId: string,
  search?: string,
  limit = 50,
  offset = 0,
): Promise<WhatsAppContactRecord[]> {
  const conditions = [eq(whatsAppContacts.tenantId, tenantId)];
  if (search) {
    conditions.push(ilike(whatsAppContacts.displayName, `%${search}%`));
  }

  return tenantDb()
    .select()
    .from(whatsAppContacts)
    .where(and(...conditions))
    .orderBy(desc(whatsAppContacts.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function findConsent(
  tenantId: string,
  contactId: string,
  purpose: WhatsAppConsentPurpose,
): Promise<WhatsAppContactConsentRecord | undefined> {
  const [consent] = await tenantDb()
    .select()
    .from(whatsAppContactConsents)
    .where(
      and(
        eq(whatsAppContactConsents.tenantId, tenantId),
        eq(whatsAppContactConsents.contactId, contactId),
        eq(whatsAppContactConsents.purpose, purpose),
      ),
    )
    .limit(1);
  return consent;
}

export async function upsertConsent(
  data: NewWhatsAppContactConsentRecord,
): Promise<WhatsAppContactConsentRecord> {
  const existing = await findConsent(
    data.tenantId,
    data.contactId,
    data.purpose as WhatsAppConsentPurpose,
  );
  if (existing) {
    const [updated] = await tenantDb()
      .update(whatsAppContactConsents)
      .set({
        status: data.status,
        consentSource: data.consentSource ?? existing.consentSource,
        evidenceReference: data.evidenceReference ?? existing.evidenceReference,
        revokedAt: data.status === 'OPTED_OUT' ? new Date() : null,
        consentedAt: data.status === 'OPTED_IN' ? new Date() : existing.consentedAt,
      })
      .where(eq(whatsAppContactConsents.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await tenantDb().insert(whatsAppContactConsents).values(data).returning();
  return created!;
}

export async function optOutContact(
  tenantId: string,
  contactId: string,
  reason: string,
): Promise<void> {
  const purposes: WhatsAppConsentPurpose[] = ['MARKETING', 'TRANSACTIONAL', 'AUTHENTICATION'];
  for (const purpose of purposes) {
    await upsertConsent({
      tenantId,
      contactId,
      purpose,
      status: 'OPTED_OUT',
      consentSource: 'INBOUND_KEYWORD',
      evidenceReference: reason,
    });
  }
}
