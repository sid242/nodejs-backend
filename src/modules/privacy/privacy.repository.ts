import { and, desc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import * as schema from '@/db/schema';
import {
  accountDeletionRequests,
  consentRecords,
  dataExportRequests,
  legalDocuments,
  tenantLegalHolds,
  tenants,
  tenantTombstones,
  users,
} from '@/db/schema';
import { TENANT_TABLES } from '@/db/tenancy/tenant-tables';

export async function createDataExportRequest(data: {
  userId: string;
  tenantId?: string | null;
  scope: 'USER' | 'TENANT';
  status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}) {
  const [created] = await db
    .insert(dataExportRequests)
    .values({
      userId: data.userId,
      tenantId: data.tenantId ?? null,
      scope: data.scope,
      status: data.status ?? 'PENDING',
    })
    .returning();
  return created;
}

export async function getDataExportById(id: string) {
  const [found] = await db
    .select()
    .from(dataExportRequests)
    .where(eq(dataExportRequests.id, id))
    .limit(1);
  return found ?? null;
}

export async function getRecentUserDataExport(userId: string, hoursAgo = 24) {
  const cutoff = new Date(Date.now() - hoursAgo * 3600 * 1000);
  const [found] = await db
    .select()
    .from(dataExportRequests)
    .where(
      and(
        eq(dataExportRequests.userId, userId),
        eq(dataExportRequests.scope, 'USER'),
        sql`${dataExportRequests.createdAt} >= ${cutoff}`,
      ),
    )
    .orderBy(desc(dataExportRequests.createdAt))
    .limit(1);
  return found ?? null;
}

export async function listUserDataExports(userId: string) {
  return db
    .select()
    .from(dataExportRequests)
    .where(and(eq(dataExportRequests.userId, userId), eq(dataExportRequests.scope, 'USER')))
    .orderBy(desc(dataExportRequests.createdAt))
    .limit(20);
}

export async function listTenantDataExports(tenantId: string) {
  return db
    .select()
    .from(dataExportRequests)
    .where(and(eq(dataExportRequests.tenantId, tenantId), eq(dataExportRequests.scope, 'TENANT')))
    .orderBy(desc(dataExportRequests.createdAt))
    .limit(20);
}

export async function updateDataExportRequest(
  id: string,
  data: Partial<typeof dataExportRequests.$inferInsert>,
) {
  const [updated] = await db
    .update(dataExportRequests)
    .set(data)
    .where(eq(dataExportRequests.id, id))
    .returning();
  return updated;
}

// Account Deletion Requests
export async function createAccountDeletionRequest(data: {
  userId: string;
  reason?: string;
  cancellationSecretHash?: string;
  graceEndsAt: Date;
}) {
  const [created] = await db
    .insert(accountDeletionRequests)
    .values({
      userId: data.userId,
      reason: data.reason,
      cancellationSecretHash: data.cancellationSecretHash,
      graceEndsAt: data.graceEndsAt,
      status: 'COOLING_PERIOD',
    })
    .returning();
  return created;
}

export async function getActiveAccountDeletionRequest(userId: string) {
  const [found] = await db
    .select()
    .from(accountDeletionRequests)
    .where(
      and(
        eq(accountDeletionRequests.userId, userId),
        eq(accountDeletionRequests.status, 'COOLING_PERIOD'),
      ),
    )
    .orderBy(desc(accountDeletionRequests.requestedAt))
    .limit(1);
  return found ?? null;
}

export async function cancelAccountDeletionRequest(id: string) {
  const [updated] = await db
    .update(accountDeletionRequests)
    .set({
      status: 'CANCELED',
      canceledAt: new Date(),
    })
    .where(eq(accountDeletionRequests.id, id))
    .returning();
  return updated;
}

export async function getExpiredCoolingPeriodRequests() {
  const now = new Date();
  return db
    .select()
    .from(accountDeletionRequests)
    .where(
      and(
        eq(accountDeletionRequests.status, 'COOLING_PERIOD'),
        lte(accountDeletionRequests.graceEndsAt, now),
      ),
    );
}

export async function markAccountDeletionAnonymized(id: string) {
  const [updated] = await db
    .update(accountDeletionRequests)
    .set({
      status: 'ANONYMIZED',
      completedAt: new Date(),
    })
    .where(eq(accountDeletionRequests.id, id))
    .returning();
  return updated;
}

// Check sole ownership across active tenants
export async function getUserSoleOwnerTenants(userId: string) {
  const ownerMemberships = await db
    .select({
      memberId: schema.tenantMembers.id,
      tenantId: schema.tenantMembers.tenantId,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
    })
    .from(schema.tenantMembers)
    .innerJoin(
      schema.tenantMemberRoles,
      eq(schema.tenantMembers.id, schema.tenantMemberRoles.memberId),
    )
    .innerJoin(schema.roles, eq(schema.tenantMemberRoles.roleId, schema.roles.id))
    .innerJoin(tenants, eq(schema.tenantMembers.tenantId, tenants.id))
    .where(
      and(
        eq(schema.tenantMembers.userId, userId),
        eq(schema.tenantMembers.status, 'ACTIVE'),
        sql`lower(${schema.roles.name}) = 'owner'`,
        isNull(tenants.deletedAt),
      ),
    );

  const soleOwnerTenants: { id: string; name: string; slug: string }[] = [];

  for (const m of ownerMemberships) {
    const [result] = await db
      .select({ count: sql<number>`count(distinct ${schema.tenantMembers.id})::int` })
      .from(schema.tenantMembers)
      .innerJoin(
        schema.tenantMemberRoles,
        eq(schema.tenantMembers.id, schema.tenantMemberRoles.memberId),
      )
      .innerJoin(schema.roles, eq(schema.tenantMemberRoles.roleId, schema.roles.id))
      .where(
        and(
          eq(schema.tenantMembers.tenantId, m.tenantId),
          eq(schema.tenantMembers.status, 'ACTIVE'),
          sql`lower(${schema.roles.name}) = 'owner'`,
        ),
      );

    const ownerCount = Number(result?.count ?? 0);
    if (ownerCount <= 1) {
      soleOwnerTenants.push({ id: m.tenantId, name: m.tenantName, slug: m.tenantSlug });
    }
  }

  return soleOwnerTenants;
}

// Anonymize user profile & purge personal credentials
export async function anonymizeUser(userId: string) {
  const now = new Date();
  const anonymizedEmail = `deleted+${userId}@invalid`;

  // 1. Invalidate sessions and verification tokens
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await db.delete(schema.verificationTokens).where(eq(schema.verificationTokens.userId, userId));

  // 2. Remove personal addresses
  await db
    .delete(schema.addresses)
    .where(and(eq(schema.addresses.ownerId, userId), eq(schema.addresses.ownerType, 'USER')));

  // 3. Remove tenant memberships (if not already closed)
  await db.delete(schema.tenantMembers).where(eq(schema.tenantMembers.userId, userId));

  // 4. Anonymize user record
  const [updatedUser] = await db
    .update(users)
    .set({
      email: anonymizedEmail,
      firstName: 'Deleted',
      lastName: 'User',
      phoneNumber: null,
      avatarUrl: null,
      passwordHash: null,
      twoFactorSecret: null,
      twoFactorRecoveryCodes: null,
      status: 'DEACTIVATED',
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId))
    .returning();

  return updatedUser;
}

// Tenant Closures & Tombstones
export async function setTenantClosed(
  tenantId: string,
  data: { closedAt: Date; purgeScheduledAt: Date; status: 'DEACTIVATED' | 'SUSPENDED' },
) {
  const [updated] = await db
    .update(tenants)
    .set({
      status: data.status,
      closedAt: data.closedAt,
      purgeScheduledAt: data.purgeScheduledAt,
    })
    .where(eq(tenants.id, tenantId))
    .returning();
  return updated;
}

export async function cancelTenantClosed(tenantId: string) {
  const [updated] = await db
    .update(tenants)
    .set({
      status: 'ACTIVE',
      closedAt: null,
      purgeScheduledAt: null,
    })
    .where(eq(tenants.id, tenantId))
    .returning();
  return updated;
}

export async function getTenantsDueForPurge() {
  const now = new Date();
  return db
    .select()
    .from(tenants)
    .where(and(lte(tenants.purgeScheduledAt, now), isNull(tenants.deletedAt)));
}

export async function createTenantTombstone(data: {
  tenantId: string;
  slug: string;
  name: string;
  reason?: string;
  closedAt: Date;
  purgedAt?: Date;
  closedByUserId?: string;
}) {
  const [tombstone] = await db
    .insert(tenantTombstones)
    .values({
      tenantId: data.tenantId,
      slug: data.slug,
      name: data.name,
      reason: (data.reason as any) || 'REQUESTED_BY_OWNER',
      closedAt: data.closedAt,
      purgedAt: data.purgedAt ?? new Date(),
      closedByUserId: data.closedByUserId,
    })
    .returning();
  return tombstone;
}

// Legal Holds
export async function placeLegalHold(data: {
  tenantId: string;
  reason: string;
  placedByStaffId: string;
}) {
  const [created] = await db
    .insert(tenantLegalHolds)
    .values({
      tenantId: data.tenantId,
      reason: data.reason,
      placedByStaffId: data.placedByStaffId,
    })
    .returning();
  return created;
}

export async function releaseLegalHold(data: {
  id: string;
  releasedByStaffId: string;
  releaseReason?: string;
}) {
  const [updated] = await db
    .update(tenantLegalHolds)
    .set({
      releasedAt: new Date(),
      releasedByStaffId: data.releasedByStaffId,
      releaseReason: data.releaseReason,
    })
    .where(eq(tenantLegalHolds.id, data.id))
    .returning();
  return updated;
}

export async function getActiveLegalHold(tenantId: string) {
  const [found] = await db
    .select()
    .from(tenantLegalHolds)
    .where(and(eq(tenantLegalHolds.tenantId, tenantId), isNull(tenantLegalHolds.releasedAt)))
    .limit(1);
  return found ?? null;
}

export async function listLegalHolds(tenantId?: string) {
  if (tenantId) {
    return db
      .select()
      .from(tenantLegalHolds)
      .where(eq(tenantLegalHolds.tenantId, tenantId))
      .orderBy(desc(tenantLegalHolds.placedAt));
  }
  return db.select().from(tenantLegalHolds).orderBy(desc(tenantLegalHolds.placedAt)).limit(100);
}

export async function isTenantUnderLegalHold(tenantId: string): Promise<boolean> {
  const hold = await getActiveLegalHold(tenantId);
  return hold !== null;
}

export async function doesUserBelongToLegalHoldTenant(userId: string): Promise<boolean> {
  const userMemberships = await db
    .select({ tenantId: schema.tenantMembers.tenantId })
    .from(schema.tenantMembers)
    .where(eq(schema.tenantMembers.userId, userId));

  for (const m of userMemberships) {
    if (await isTenantUnderLegalHold(m.tenantId)) {
      return true;
    }
  }
  return false;
}

// Consent Records & Legal Documents
export async function recordConsent(data: {
  userId: string;
  tenantId?: string | null;
  type: 'TERMS' | 'PRIVACY' | 'MARKETING' | 'COOKIES';
  version: string;
  ip?: string;
  userAgent?: string;
}) {
  const [record] = await db
    .insert(consentRecords)
    .values({
      userId: data.userId,
      tenantId: data.tenantId ?? null,
      type: data.type,
      version: data.version,
      ip: data.ip,
      userAgent: data.userAgent,
    })
    .returning();

  if (data.type === 'TERMS') {
    await db
      .update(users)
      .set({
        termsAcceptedAt: new Date(),
        termsVersion: data.version,
      })
      .where(eq(users.id, data.userId));
  } else if (data.type === 'MARKETING') {
    await db.update(users).set({ marketingOptIn: true }).where(eq(users.id, data.userId));
  }

  return record;
}

export async function getUserConsentRecords(userId: string) {
  return db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.userId, userId))
    .orderBy(desc(consentRecords.acceptedAt));
}

export async function listActiveLegalDocuments() {
  return db
    .select()
    .from(legalDocuments)
    .where(eq(legalDocuments.isActive, true))
    .orderBy(desc(legalDocuments.effectiveAt));
}

export async function upsertLegalDocument(data: {
  type: 'TERMS' | 'PRIVACY' | 'MARKETING' | 'COOKIES';
  version: string;
  title: string;
  url: string;
  contentSummary?: string;
  effectiveAt?: Date;
}) {
  const [doc] = await db
    .insert(legalDocuments)
    .values({
      type: data.type,
      version: data.version,
      title: data.title,
      url: data.url,
      contentSummary: data.contentSummary,
      effectiveAt: data.effectiveAt ?? new Date(),
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [legalDocuments.type, legalDocuments.version],
      set: {
        title: data.title,
        url: data.url,
        contentSummary: data.contentSummary,
        effectiveAt: data.effectiveAt ?? new Date(),
        isActive: true,
      },
    })
    .returning();
  return doc;
}

// Purge Tenant Rows across registered tables in reverse dependency order
export async function purgeTenantData(tenantId: string) {
  const reversedTables = [...TENANT_TABLES].reverse();

  for (const reg of reversedTables) {
    try {
      const col = (reg.table as any)[reg.tenantColumn];
      if (col) {
        await db.delete(reg.table).where(eq(col, tenantId));
      }
    } catch {
      // Continue through remaining tables
    }
  }

  // Soft delete tenant
  await db
    .update(tenants)
    .set({
      status: 'DEACTIVATED',
      deletedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
}
