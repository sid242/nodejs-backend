import { and, desc, eq } from 'drizzle-orm';

import {
  platformWhatsAppAccountRegistry,
  whatsAppBusinessAccounts,
  whatsAppPhoneNumbers,
  type NewPlatformWhatsAppAccountRegistryRecord,
  type NewWhatsAppBusinessAccountRecord,
  type NewWhatsAppPhoneNumberRecord,
  type WhatsAppBusinessAccountRecord,
  type WhatsAppPhoneNumberRecord,
} from '@/db/schema';
import { primaryDbHandle, tenantDb } from '@/db/tenancy/context';
import { AppError } from '@/lib/errors';

export type { WhatsAppBusinessAccountRecord, WhatsAppPhoneNumberRecord };

export async function findAccountByTenantId(
  tenantId: string,
): Promise<WhatsAppBusinessAccountRecord | undefined> {
  const [account] = await tenantDb()
    .select()
    .from(whatsAppBusinessAccounts)
    .where(eq(whatsAppBusinessAccounts.tenantId, tenantId))
    .limit(1);
  return account;
}

export async function findAccountByWabaId(
  tenantId: string,
  wabaId: string,
): Promise<WhatsAppBusinessAccountRecord | undefined> {
  const [account] = await tenantDb()
    .select()
    .from(whatsAppBusinessAccounts)
    .where(
      and(
        eq(whatsAppBusinessAccounts.tenantId, tenantId),
        eq(whatsAppBusinessAccounts.wabaId, wabaId),
      ),
    )
    .limit(1);
  return account;
}

export async function createOrUpdateAccount(
  data: NewWhatsAppBusinessAccountRecord,
): Promise<WhatsAppBusinessAccountRecord> {
  const existing = await findAccountByWabaId(data.tenantId, data.wabaId);
  if (existing) {
    const [updated] = await tenantDb()
      .update(whatsAppBusinessAccounts)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(whatsAppBusinessAccounts.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await tenantDb().insert(whatsAppBusinessAccounts).values(data).returning();
  return created!;
}

export async function disconnectAccount(
  tenantId: string,
  accountId: string,
): Promise<WhatsAppBusinessAccountRecord | undefined> {
  const [updated] = await tenantDb()
    .update(whatsAppBusinessAccounts)
    .set({
      connectionStatus: 'DISCONNECTED',
      disconnectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsAppBusinessAccounts.id, accountId),
        eq(whatsAppBusinessAccounts.tenantId, tenantId),
      ),
    )
    .returning();

  if (updated) {
    await primaryDbHandle()
      .update(platformWhatsAppAccountRegistry)
      .set({
        connectionStatus: 'DISCONNECTED',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(platformWhatsAppAccountRegistry.tenantId, tenantId),
          eq(platformWhatsAppAccountRegistry.wabaId, updated.wabaId),
        ),
      );
  }

  return updated;
}

export async function listPhoneNumbers(
  tenantId: string,
  businessAccountId?: string,
): Promise<WhatsAppPhoneNumberRecord[]> {
  const conditions = [eq(whatsAppPhoneNumbers.tenantId, tenantId)];
  if (businessAccountId) {
    conditions.push(eq(whatsAppPhoneNumbers.businessAccountId, businessAccountId));
  }

  return tenantDb()
    .select()
    .from(whatsAppPhoneNumbers)
    .where(and(...conditions))
    .orderBy(desc(whatsAppPhoneNumbers.createdAt));
}

export async function findPhoneNumberById(
  tenantId: string,
  id: string,
): Promise<WhatsAppPhoneNumberRecord | undefined> {
  const [record] = await tenantDb()
    .select()
    .from(whatsAppPhoneNumbers)
    .where(and(eq(whatsAppPhoneNumbers.id, id), eq(whatsAppPhoneNumbers.tenantId, tenantId)))
    .limit(1);
  return record;
}

export async function findPhoneNumberByProviderId(
  tenantId: string,
  phoneNumberId: string,
): Promise<WhatsAppPhoneNumberRecord | undefined> {
  const [record] = await tenantDb()
    .select()
    .from(whatsAppPhoneNumbers)
    .where(
      and(
        eq(whatsAppPhoneNumbers.phoneNumberId, phoneNumberId),
        eq(whatsAppPhoneNumbers.tenantId, tenantId),
      ),
    )
    .limit(1);
  return record;
}

export async function upsertPhoneNumber(
  data: NewWhatsAppPhoneNumberRecord,
): Promise<WhatsAppPhoneNumberRecord> {
  const [existing] = await tenantDb()
    .select()
    .from(whatsAppPhoneNumbers)
    .where(
      and(
        eq(whatsAppPhoneNumbers.tenantId, data.tenantId),
        eq(whatsAppPhoneNumbers.phoneNumberId, data.phoneNumberId),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await tenantDb()
      .update(whatsAppPhoneNumbers)
      .set({
        displayPhoneNumber: data.displayPhoneNumber,
        verifiedName: data.verifiedName,
        qualityRating: data.qualityRating,
        messagingLimit: data.messagingLimit,
        registrationStatus: data.registrationStatus,
        updatedAt: new Date(),
      })
      .where(eq(whatsAppPhoneNumbers.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await tenantDb().insert(whatsAppPhoneNumbers).values(data).returning();
  return created!;
}

export async function setDefaultPhoneNumber(
  tenantId: string,
  phoneNumberId: string,
): Promise<void> {
  await tenantDb()
    .update(whatsAppPhoneNumbers)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(eq(whatsAppPhoneNumbers.tenantId, tenantId));

  await tenantDb()
    .update(whatsAppPhoneNumbers)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(
      and(
        eq(whatsAppPhoneNumbers.tenantId, tenantId),
        eq(whatsAppPhoneNumbers.phoneNumberId, phoneNumberId),
      ),
    );
}

export async function updatePhoneNumberStatus(
  tenantId: string,
  id: string,
  isEnabled: boolean,
): Promise<WhatsAppPhoneNumberRecord | undefined> {
  const [updated] = await tenantDb()
    .update(whatsAppPhoneNumbers)
    .set({ isEnabled, updatedAt: new Date() })
    .where(and(eq(whatsAppPhoneNumbers.id, id), eq(whatsAppPhoneNumbers.tenantId, tenantId)))
    .returning();
  return updated;
}

// Central Platform Registry Queries (Primary DB)
export async function registerPlatformAccount(
  data: NewPlatformWhatsAppAccountRegistryRecord,
): Promise<void> {
  const [existing] = await primaryDbHandle()
    .select()
    .from(platformWhatsAppAccountRegistry)
    .where(eq(platformWhatsAppAccountRegistry.phoneNumberId, data.phoneNumberId))
    .limit(1);

  if (existing) {
    if (existing.tenantId !== data.tenantId && existing.connectionStatus === 'CONNECTED') {
      throw AppError.conflict(
        `WhatsApp Phone Number ID ${data.phoneNumberId} is already connected to another tenant. The current owner must disconnect it first.`,
        { code: 'WHATSAPP_PHONE_ALREADY_REGISTERED' },
      );
    }

    await primaryDbHandle()
      .update(platformWhatsAppAccountRegistry)
      .set({
        tenantId: data.tenantId,
        wabaId: data.wabaId,
        databaseRoutingKey: data.databaseRoutingKey,
        connectionStatus: data.connectionStatus,
        updatedAt: new Date(),
      })
      .where(eq(platformWhatsAppAccountRegistry.id, existing.id));
  } else {
    await primaryDbHandle().insert(platformWhatsAppAccountRegistry).values(data);
  }
}

export async function resolveTenantByPhoneNumberId(phoneNumberId: string): Promise<
  | {
      tenantId: string;
      wabaId: string;
      connectionStatus: string;
      databaseRoutingKey?: string | null;
    }
  | undefined
> {
  const [record] = await primaryDbHandle()
    .select({
      tenantId: platformWhatsAppAccountRegistry.tenantId,
      wabaId: platformWhatsAppAccountRegistry.wabaId,
      connectionStatus: platformWhatsAppAccountRegistry.connectionStatus,
      databaseRoutingKey: platformWhatsAppAccountRegistry.databaseRoutingKey,
    })
    .from(platformWhatsAppAccountRegistry)
    .where(eq(platformWhatsAppAccountRegistry.phoneNumberId, phoneNumberId))
    .limit(1);

  return record;
}
