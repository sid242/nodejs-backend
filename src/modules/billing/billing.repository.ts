import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import {
  appModules,
  billingWebhooks,
  entitlementDefinitions,
  files,
  invoices,
  payments,
  planEntitlements,
  planModules,
  plans,
  refunds,
  roles,
  subscriptionChanges,
  subscriptionEvents,
  subscriptions,
  tenantEntitlementOverrides,
  tenantInvitations,
  tenantMembers,
  tenants,
  tenantUsageRecords,
  type BillingWebhook,
  type EntitlementDefinition,
  type Invoice,
  type NewBillingWebhook,
  type NewInvoice,
  type NewPayment,
  type NewPlan,
  type NewRefund,
  type NewSubscription,
  type NewSubscriptionChange,
  type NewSubscriptionEvent,
  type Payment,
  type Plan,
  type Refund,
  type Subscription,
  type SubscriptionChange,
  type SubscriptionEvent,
  type TenantEntitlementOverride,
} from '@/db/schema';

import type {
  ListPaymentsQueryDto,
  ListPlansQueryDto,
  ListPlatformPaymentsQueryDto,
  ListPlatformSubscriptionsQueryDto,
} from './billing.dto';
import {
  DEFAULT_ENTITLEMENT_DEFINITIONS,
  DEFAULT_PLAN_ENTITLEMENT_VALUES,
} from './entitlements.defaults';

export interface PlanWithModules extends Plan {
  modules: string[];
  entitlements?: Record<string, any>;
}

export interface SubscriptionWithPlan extends Subscription {
  plan: PlanWithModules | null;
}

export interface TenantUsage {
  members: number;
  storageBytes: number;
  customRoles: number;
  metrics?: Record<string, number>;
}

export interface InvoiceWithDetails extends Invoice {
  tenantName?: string;
  planName?: string | null;
}

// ==========================================
// 1. Plan Repository Operations
// ==========================================

export async function findPlanByKey(key: string): Promise<PlanWithModules | null> {
  const [record] = await db.select().from(plans).where(eq(plans.key, key.toUpperCase())).limit(1);

  if (!record) return null;
  const modules = await getPlanModuleKeys(record.id);
  const planEnts = await findPlanEntitlements(record.id);
  const fallbackEnts = DEFAULT_PLAN_ENTITLEMENT_VALUES[record.key] ?? {};
  const entitlements = Object.keys(planEnts).length > 0 ? planEnts : fallbackEnts;

  return { ...record, modules, entitlements };
}

export async function findPlanById(id: string): Promise<PlanWithModules | null> {
  const [record] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  if (!record) return null;
  const modules = await getPlanModuleKeys(record.id);
  const planEnts = await findPlanEntitlements(record.id);
  const fallbackEnts = DEFAULT_PLAN_ENTITLEMENT_VALUES[record.key] ?? {};
  const entitlements = Object.keys(planEnts).length > 0 ? planEnts : fallbackEnts;

  return { ...record, modules, entitlements };
}

export async function findActivePublicPlans(): Promise<PlanWithModules[]> {
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.isActive, true), eq(plans.isPublic, true)))
    .orderBy(plans.sortOrder, plans.priceMonthlyMinor);

  return Promise.all(
    (rows ?? []).map(async (p) => {
      const modules = await getPlanModuleKeys(p.id);
      const planEnts = await findPlanEntitlements(p.id);
      const fallbackEnts = DEFAULT_PLAN_ENTITLEMENT_VALUES[p.key] ?? {};
      const entitlements = Object.keys(planEnts).length > 0 ? planEnts : fallbackEnts;
      return { ...p, modules, entitlements };
    }),
  );
}

export async function findAllPlans(
  options?: Partial<ListPlansQueryDto>,
): Promise<PlanWithModules[]> {
  const conditions = [];

  if (
    options?.status === 'active' ||
    (!options?.includeInactive && options?.status !== 'inactive' && options?.status !== 'all')
  ) {
    conditions.push(eq(plans.isActive, true));
  } else if (options?.status === 'inactive') {
    conditions.push(eq(plans.isActive, false));
  }

  if (options?.search) {
    const searchPattern = `%${options.search}%`;
    conditions.push(
      sql`(${plans.name} ILIKE ${searchPattern} OR ${plans.key} ILIKE ${searchPattern})`,
    );
  }

  if (options?.billingInterval && options.billingInterval !== 'ALL') {
    conditions.push(eq(plans.billingInterval, options.billingInterval));
  }

  if (options?.currency) {
    conditions.push(eq(plans.currency, options.currency.toUpperCase()));
  }

  if (options?.minPriceMinor !== undefined) {
    conditions.push(sql`${plans.priceMonthlyMinor} >= ${options.minPriceMinor}`);
  }

  if (options?.maxPriceMinor !== undefined) {
    conditions.push(sql`${plans.priceMonthlyMinor} <= ${options.maxPriceMinor}`);
  }

  if (options?.createdAfter) {
    conditions.push(sql`${plans.createdAt} >= ${options.createdAfter}`);
  }

  if (options?.createdBefore) {
    conditions.push(sql`${plans.createdAt} <= ${options.createdBefore}`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(plans)
    .where(whereClause)
    .orderBy(plans.sortOrder, plans.priceMonthlyMinor);

  const mapped = await Promise.all(
    (rows ?? []).map(async (p) => {
      const modules = await getPlanModuleKeys(p.id);
      const planEnts = await findPlanEntitlements(p.id);
      const fallbackEnts = DEFAULT_PLAN_ENTITLEMENT_VALUES[p.key] ?? {};
      const entitlements = Object.keys(planEnts).length > 0 ? planEnts : fallbackEnts;

      return {
        ...p,
        modules,
        entitlements,
      };
    }),
  );

  if (options?.entitlement) {
    const filterKey = options.entitlement.trim();
    return mapped.filter((p) => {
      const val = p.entitlements?.[filterKey];
      return val !== undefined && val !== null && val !== false && val !== 0;
    });
  }

  return mapped;
}

export async function getPlanModuleKeys(planId: string): Promise<string[]> {
  const rows = await db
    .select({ key: appModules.key })
    .from(planModules)
    .innerJoin(appModules, eq(planModules.moduleId, appModules.id))
    .where(eq(planModules.planId, planId));

  return (rows ?? []).map((r) => r.key);
}

export async function createPlan(
  data: NewPlan,
  moduleKeys?: string[],
  entitlementsMap?: Record<string, any>,
): Promise<PlanWithModules> {
  return db.transaction(async (tx) => {
    const [record] = await tx.insert(plans).values(data).returning();
    if (!record) throw new Error('Failed to create plan record');

    if (moduleKeys?.length) {
      const moduleRows = await tx
        .select({ id: appModules.id })
        .from(appModules)
        .where(inArray(appModules.key, moduleKeys));

      if (moduleRows.length > 0) {
        await tx.insert(planModules).values(
          moduleRows.map((m) => ({
            planId: record.id,
            moduleId: m.id,
          })),
        );
      }
    }

    if (entitlementsMap && Object.keys(entitlementsMap).length > 0) {
      await setPlanEntitlements(record.id, entitlementsMap, tx);
    }

    const modules = await tx
      .select({ key: appModules.key })
      .from(planModules)
      .innerJoin(appModules, eq(planModules.moduleId, appModules.id))
      .where(eq(planModules.planId, record.id));

    const planEnts = await findPlanEntitlements(record.id);

    return {
      ...record,
      modules: modules.map((m) => m.key),
      entitlements: planEnts,
    };
  });
}

export async function updatePlan(
  id: string,
  data: Partial<NewPlan>,
  moduleKeys?: string[],
  entitlementsMap?: Record<string, any>,
): Promise<PlanWithModules | null> {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .update(plans)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(plans.id, id))
      .returning();

    if (!record) return null;

    if (moduleKeys !== undefined) {
      await tx.delete(planModules).where(eq(planModules.planId, id));
      if (moduleKeys.length > 0) {
        const moduleRows = await tx
          .select({ id: appModules.id })
          .from(appModules)
          .where(inArray(appModules.key, moduleKeys));

        if (moduleRows.length > 0) {
          await tx.insert(planModules).values(
            moduleRows.map((m) => ({
              planId: id,
              moduleId: m.id,
            })),
          );
        }
      }
    }

    if (entitlementsMap && Object.keys(entitlementsMap).length > 0) {
      await setPlanEntitlements(id, entitlementsMap, tx);
    }

    const modules = await tx
      .select({ key: appModules.key })
      .from(planModules)
      .innerJoin(appModules, eq(planModules.moduleId, appModules.id))
      .where(eq(planModules.planId, id));

    const planEnts = await findPlanEntitlements(id);

    return {
      ...record,
      modules: modules.map((m) => m.key),
      entitlements: planEnts,
    };
  });
}

// ==========================================
// 2. Entitlement Definitions & Mappings
// ==========================================

export async function findEntitlementDefinitions(): Promise<EntitlementDefinition[]> {
  const rows = await db.select().from(entitlementDefinitions);
  if (rows.length < DEFAULT_ENTITLEMENT_DEFINITIONS.length) {
    try {
      await db
        .insert(entitlementDefinitions)
        .values(
          DEFAULT_ENTITLEMENT_DEFINITIONS.map((def) => ({
            key: def.key,
            label: def.label,
            description: def.description,
            type: def.type,
            unit: def.unit,
            validation: def.validation,
            defaultValue: def.defaultValue,
          })),
        )
        .onConflictDoNothing();
      return db.select().from(entitlementDefinitions);
    } catch {
      return rows;
    }
  }
  return rows;
}

export async function findPlanEntitlements(planId: string): Promise<Record<string, any>> {
  const rows = await db.select().from(planEntitlements).where(eq(planEntitlements.planId, planId));

  const result: Record<string, any> = {};
  for (const r of rows ?? []) {
    result[r.entitlementKey] = r.value;
  }
  return result;
}

export async function setPlanEntitlements(
  planId: string,
  entitlementsMap: Record<string, any>,
  tx?: any,
): Promise<void> {
  const client = tx ?? db;
  for (const [key, value] of Object.entries(entitlementsMap)) {
    const [existing] = await client
      .select()
      .from(planEntitlements)
      .where(and(eq(planEntitlements.planId, planId), eq(planEntitlements.entitlementKey, key)))
      .limit(1);

    if (existing) {
      await client
        .update(planEntitlements)
        .set({ value, updatedAt: new Date() })
        .where(eq(planEntitlements.id, existing.id));
    } else {
      await client.insert(planEntitlements).values({
        planId,
        entitlementKey: key,
        value,
      });
    }
  }
}

export async function findTenantEntitlementOverrides(
  tenantId: string,
): Promise<TenantEntitlementOverride[]> {
  return db
    .select()
    .from(tenantEntitlementOverrides)
    .where(
      and(
        eq(tenantEntitlementOverrides.tenantId, tenantId),
        sql`(${tenantEntitlementOverrides.expiresAt} IS NULL OR ${tenantEntitlementOverrides.expiresAt} > now())`,
      ),
    );
}

export async function setTenantEntitlementOverride(data: {
  tenantId: string;
  entitlementKey: string;
  value: any;
  expiresAt?: Date | null;
  reason?: string;
  createdBy?: string;
}): Promise<TenantEntitlementOverride> {
  const [existing] = await db
    .select()
    .from(tenantEntitlementOverrides)
    .where(
      and(
        eq(tenantEntitlementOverrides.tenantId, data.tenantId),
        eq(tenantEntitlementOverrides.entitlementKey, data.entitlementKey),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(tenantEntitlementOverrides)
      .set({
        value: data.value,
        expiresAt: data.expiresAt,
        reason: data.reason,
        createdBy: data.createdBy ?? 'system',
        updatedAt: new Date(),
      })
      .where(eq(tenantEntitlementOverrides.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await db
    .insert(tenantEntitlementOverrides)
    .values({
      tenantId: data.tenantId,
      entitlementKey: data.entitlementKey,
      value: data.value,
      expiresAt: data.expiresAt,
      reason: data.reason,
      createdBy: data.createdBy ?? 'system',
    })
    .returning();
  return created!;
}

export async function removeTenantEntitlementOverride(
  tenantId: string,
  entitlementKey: string,
): Promise<boolean> {
  const result = await db
    .delete(tenantEntitlementOverrides)
    .where(
      and(
        eq(tenantEntitlementOverrides.tenantId, tenantId),
        eq(tenantEntitlementOverrides.entitlementKey, entitlementKey),
      ),
    )
    .returning();
  return (result?.length ?? 0) > 0;
}

// ==========================================
// 3. Subscription Management & Lifecycle
// ==========================================

export async function findTenantSubscription(tenantId: string): Promise<Subscription | null> {
  const [record] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  return record ?? null;
}

export async function findTenantSubscriptionWithPlan(
  tenantId: string,
): Promise<SubscriptionWithPlan | null> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (!sub) return null;

  const plan = await findPlanById(sub.planId);
  return { ...sub, plan };
}

export async function createSubscription(data: NewSubscription, tx?: any): Promise<Subscription> {
  const client = tx ?? db;
  const [record] = await client.insert(subscriptions).values(data).returning();
  if (!record) throw new Error('Failed to create subscription record');
  return record;
}

export async function updateSubscription(
  id: string,
  data: Partial<NewSubscription>,
): Promise<Subscription | null> {
  const [record] = await db
    .update(subscriptions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(subscriptions.id, id))
    .returning();

  return record ?? null;
}

export async function createSubscriptionEvent(
  data: NewSubscriptionEvent,
  tx?: any,
): Promise<SubscriptionEvent> {
  const client = tx ?? db;
  const [record] = await client.insert(subscriptionEvents).values(data).returning();
  if (!record) throw new Error('Failed to create subscription event');
  return record;
}

export async function findSubscriptionEvents(tenantId: string): Promise<SubscriptionEvent[]> {
  return db
    .select()
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.tenantId, tenantId))
    .orderBy(desc(subscriptionEvents.createdAt))
    .limit(50);
}

export async function listSubscriptionsForPlatform(
  options?: ListPlatformSubscriptionsQueryDto,
): Promise<{ subscriptions: any[]; total: number; page: number; limit: number }> {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (options?.tenantId) {
    conditions.push(eq(subscriptions.tenantId, options.tenantId));
  }
  if (options?.status && options.status !== 'ALL') {
    conditions.push(eq(subscriptions.status, options.status as any));
  }
  if (options?.billingInterval && options.billingInterval !== 'ALL') {
    conditions.push(eq(subscriptions.billingInterval, options.billingInterval));
  }
  if (options?.provider) {
    conditions.push(eq(subscriptions.provider, options.provider));
  }
  if (options?.periodEndBefore) {
    conditions.push(sql`${subscriptions.currentPeriodEnd} <= ${options.periodEndBefore}`);
  }
  if (options?.periodEndAfter) {
    conditions.push(sql`${subscriptions.currentPeriodEnd} >= ${options.periodEndAfter}`);
  }
  if (options?.trialEndBefore) {
    conditions.push(sql`${subscriptions.trialEndsAt} <= ${options.trialEndBefore}`);
  }
  if (options?.trialEndAfter) {
    conditions.push(sql`${subscriptions.trialEndsAt} >= ${options.trialEndAfter}`);
  }

  const baseQuery = db
    .select({
      subscription: subscriptions,
      tenant: {
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
      },
      plan: {
        id: plans.id,
        key: plans.key,
        name: plans.name,
        priceMonthlyMinor: plans.priceMonthlyMinor,
        currency: plans.currency,
      },
    })
    .from(subscriptions)
    .innerJoin(tenants, eq(subscriptions.tenantId, tenants.id))
    .innerJoin(plans, eq(subscriptions.planId, plans.id));

  if (options?.planKey) {
    conditions.push(eq(plans.key, options.planKey.toUpperCase()));
  }

  if (options?.search) {
    const searchPattern = `%${options.search}%`;
    conditions.push(
      sql`(${tenants.name} ILIKE ${searchPattern} OR ${subscriptions.billingEmail} ILIKE ${searchPattern} OR ${tenants.slug} ILIKE ${searchPattern})`,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ total: count() })
    .from(subscriptions)
    .innerJoin(tenants, eq(subscriptions.tenantId, tenants.id))
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(whereClause);

  const total = Number(countResult?.total ?? 0);

  const rows = await baseQuery
    .where(whereClause)
    .orderBy(desc(subscriptions.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    subscriptions: rows.map((r) => ({
      ...r.subscription,
      tenantName: r.tenant?.name,
      tenantSlug: r.tenant?.slug,
      planKey: r.plan?.key,
      planName: r.plan?.name,
      priceMonthlyMinor: r.plan?.priceMonthlyMinor,
      currency: r.plan?.currency,
    })),
    total,
    page,
    limit,
  };
}

// ==========================================
// 4. Usage & Quotas Calculation
// ==========================================

export async function getTenantUsage(tenantId: string): Promise<TenantUsage> {
  // 1. Members count (active members + pending invitations)
  const [activeMembersRow] = await db
    .select({ total: count() })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.status, 'ACTIVE')));

  const [pendingInvitesRow] = await db
    .select({ total: count() })
    .from(tenantInvitations)
    .where(and(eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.status, 'PENDING')));

  const membersCount = Number(activeMembersRow?.total ?? 0) + Number(pendingInvitesRow?.total ?? 0);

  // 2. Storage bytes (files uploaded to this tenant)
  const [storageRow] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${files.size}), 0)::bigint` })
    .from(files)
    .where(and(eq(files.tenantId, tenantId), eq(files.status, 'UPLOADED')));

  const storageBytes = Number(storageRow?.totalBytes ?? 0);

  // 3. Custom roles count (roles owned by tenant, non-system)
  const [customRolesRow] = await db
    .select({ total: count() })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.isSystem, false)));

  const customRolesCount = Number(customRolesRow?.total ?? 0);

  // 4. Any recorded metrics in tenantUsageRecords
  const recorded = await db
    .select()
    .from(tenantUsageRecords)
    .where(eq(tenantUsageRecords.tenantId, tenantId));

  const metrics: Record<string, number> = {
    'members.max': membersCount,
    'storage.gb': Math.ceil(storageBytes / (1024 * 1024 * 1024)),
    'custom_roles.max': customRolesCount,
  };

  for (const r of recorded ?? []) {
    metrics[r.entitlementKey] = r.currentUsage;
  }

  return {
    members: membersCount,
    storageBytes,
    customRoles: customRolesCount,
    metrics,
  };
}

export async function setTenantUsageRecord(
  tenantId: string,
  entitlementKey: string,
  currentUsage: number,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(tenantUsageRecords)
    .where(
      and(
        eq(tenantUsageRecords.tenantId, tenantId),
        eq(tenantUsageRecords.entitlementKey, entitlementKey),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(tenantUsageRecords)
      .set({ currentUsage, lastRecordedAt: new Date() })
      .where(eq(tenantUsageRecords.id, existing.id));
  } else {
    await db.insert(tenantUsageRecords).values({
      tenantId,
      entitlementKey,
      currentUsage,
      lastRecordedAt: new Date(),
    });
  }
}

// ==========================================
// 5. Billing Webhooks Idempotency
// ==========================================

export async function findBillingWebhook(
  provider: string,
  eventId: string,
): Promise<BillingWebhook | null> {
  const [record] = await db
    .select()
    .from(billingWebhooks)
    .where(and(eq(billingWebhooks.provider, provider), eq(billingWebhooks.eventId, eventId)))
    .limit(1);
  return record ?? null;
}

export async function createBillingWebhook(data: NewBillingWebhook): Promise<BillingWebhook> {
  const [record] = await db.insert(billingWebhooks).values(data).returning();
  return record!;
}

// ==========================================
// 6. Invoices Repository Operations
// ==========================================

export async function generateInvoiceNumber(): Promise<string> {
  const currentYear = new Date().getFullYear();
  const [result] = await db.select({ total: count() }).from(invoices);
  const sequence = (Number(result?.total ?? 0) + 1).toString().padStart(5, '0');
  return `INV-${currentYear}-${sequence}`;
}

export async function createInvoice(
  data: Omit<NewInvoice, 'id' | 'invoiceNumber' | 'totalCents' | 'createdAt' | 'updatedAt'> & {
    invoiceNumber?: string;
  },
): Promise<Invoice> {
  const invoiceNumber = data.invoiceNumber ?? (await generateInvoiceNumber());
  const amountCents = Number(data.amountCents ?? 0);
  const taxCents = Number(data.taxCents ?? 0);
  const totalCents = amountCents + taxCents;

  const [record] = await db
    .insert(invoices)
    .values({
      ...data,
      invoiceNumber,
      totalCents,
    })
    .returning();

  if (!record) throw new Error('Failed to create invoice record');
  return record;
}

export async function findInvoiceById(id: string): Promise<InvoiceWithDetails | null> {
  const [row] = await db
    .select({
      invoice: invoices,
      tenantName: tenants.name,
      planName: plans.name,
    })
    .from(invoices)
    .innerJoin(tenants, eq(invoices.tenantId, tenants.id))
    .leftJoin(plans, eq(invoices.planId, plans.id))
    .where(eq(invoices.id, id))
    .limit(1);

  if (!row) return null;

  return {
    ...row.invoice,
    tenantName: row.tenantName,
    planName: row.planName,
  };
}

export async function findInvoicesByTenantId(
  tenantId: string,
  options?: {
    page?: number;
    limit?: number;
    status?: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTABLE';
  },
): Promise<{ items: Invoice[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, options?.page ?? 1);
  const limit = Math.min(100, Math.max(1, options?.limit ?? 20));
  const offset = (page - 1) * limit;

  const conditions = [eq(invoices.tenantId, tenantId)];
  if (options?.status) {
    conditions.push(eq(invoices.status, options.status));
  }
  const where = and(...conditions);

  const [countRes] = await db.select({ total: count() }).from(invoices).where(where);
  const items = await db
    .select()
    .from(invoices)
    .where(where)
    .orderBy(desc(invoices.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    items: items ?? [],
    total: Number(countRes?.total ?? 0),
    page,
    limit,
  };
}

export async function listInvoicesForPlatform(options?: {
  page?: number;
  limit?: number;
  tenantId?: string;
  status?: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTABLE';
}): Promise<{ items: InvoiceWithDetails[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, options?.page ?? 1);
  const limit = Math.min(100, Math.max(1, options?.limit ?? 20));
  const offset = (page - 1) * limit;

  const conditions = [];
  if (options?.tenantId) conditions.push(eq(invoices.tenantId, options.tenantId));
  if (options?.status) conditions.push(eq(invoices.status, options.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRes] = await db.select({ total: count() }).from(invoices).where(where);
  const rows = await db
    .select({
      invoice: invoices,
      tenantName: tenants.name,
      planName: plans.name,
    })
    .from(invoices)
    .innerJoin(tenants, eq(invoices.tenantId, tenants.id))
    .leftJoin(plans, eq(invoices.planId, plans.id))
    .where(where)
    .orderBy(desc(invoices.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    items: (rows ?? []).map((r) => ({
      ...r.invoice,
      tenantName: r.tenantName,
      planName: r.planName,
    })),
    total: Number(countRes?.total ?? 0),
    page,
    limit,
  };
}

export async function updateInvoiceStatus(
  id: string,
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTABLE',
  paidAt?: Date,
): Promise<Invoice | null> {
  const [record] = await db
    .update(invoices)
    .set({
      status,
      paidAt: paidAt ?? (status === 'PAID' ? new Date() : null),
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, id))
    .returning();

  return record ?? null;
}

// ==========================================
// 7. Payments Repository Operations
// ==========================================

export async function createPayment(data: NewPayment): Promise<Payment> {
  const [record] = await db.insert(payments).values(data).returning();
  if (!record) throw new Error('Failed to create payment record');
  return record;
}

export async function findPaymentById(id: string): Promise<Payment | null> {
  const [record] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return record ?? null;
}

export async function findPaymentByOrderId(orderId: string): Promise<Payment | null> {
  const [record] = await db
    .select()
    .from(payments)
    .where(eq(payments.providerOrderId, orderId))
    .limit(1);
  return record ?? null;
}

export async function findPaymentByPaymentId(paymentId: string): Promise<Payment | null> {
  const [record] = await db
    .select()
    .from(payments)
    .where(eq(payments.providerPaymentId, paymentId))
    .limit(1);
  return record ?? null;
}

export async function updatePayment(
  id: string,
  data: Partial<NewPayment>,
): Promise<Payment | null> {
  const [record] = await db
    .update(payments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(payments.id, id))
    .returning();
  return record ?? null;
}

export async function findPaymentsByTenantId(
  tenantId: string,
  options?: Partial<ListPaymentsQueryDto>,
): Promise<{ items: Payment[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, options?.page ?? 1);
  const limit = Math.min(100, Math.max(1, options?.limit ?? 20));
  const offset = (page - 1) * limit;

  const conditions = [eq(payments.tenantId, tenantId)];
  if (options?.status) {
    conditions.push(eq(payments.status, options.status));
  }
  const where = and(...conditions);

  const [countRes] = await db.select({ total: count() }).from(payments).where(where);
  const items = await db
    .select()
    .from(payments)
    .where(where)
    .orderBy(desc(payments.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    items: items ?? [],
    total: Number(countRes?.total ?? 0),
    page,
    limit,
  };
}

export async function listPaymentsForPlatform(
  options?: Partial<ListPlatformPaymentsQueryDto>,
): Promise<{ items: any[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, options?.page ?? 1);
  const limit = Math.min(100, Math.max(1, options?.limit ?? 20));
  const offset = (page - 1) * limit;

  const conditions = [];
  if (options?.tenantId) conditions.push(eq(payments.tenantId, options.tenantId));
  if (options?.status) conditions.push(eq(payments.status, options.status));
  if (options?.providerOrderId)
    conditions.push(eq(payments.providerOrderId, options.providerOrderId));
  if (options?.providerPaymentId)
    conditions.push(eq(payments.providerPaymentId, options.providerPaymentId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRes] = await db.select({ total: count() }).from(payments).where(where);
  const rows = await db
    .select({
      payment: payments,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
    })
    .from(payments)
    .innerJoin(tenants, eq(payments.tenantId, tenants.id))
    .where(where)
    .orderBy(desc(payments.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    items: (rows ?? []).map((r) => ({
      ...r.payment,
      tenantName: r.tenantName,
      tenantSlug: r.tenantSlug,
    })),
    total: Number(countRes?.total ?? 0),
    page,
    limit,
  };
}

// ==========================================
// 8. Refunds Repository Operations
// ==========================================

export async function createRefund(data: NewRefund): Promise<Refund> {
  const [record] = await db.insert(refunds).values(data).returning();
  if (!record) throw new Error('Failed to create refund record');
  return record;
}

export async function findRefundById(id: string): Promise<Refund | null> {
  const [record] = await db.select().from(refunds).where(eq(refunds.id, id)).limit(1);
  return record ?? null;
}

export async function findRefundByProviderRefundId(
  providerRefundId: string,
): Promise<Refund | null> {
  const [record] = await db
    .select()
    .from(refunds)
    .where(eq(refunds.providerRefundId, providerRefundId))
    .limit(1);
  return record ?? null;
}

export async function findRefundsByPaymentId(paymentId: string): Promise<Refund[]> {
  return db
    .select()
    .from(refunds)
    .where(eq(refunds.paymentId, paymentId))
    .orderBy(desc(refunds.createdAt));
}

export async function findRefundsByTenantId(tenantId: string): Promise<Refund[]> {
  return db
    .select()
    .from(refunds)
    .where(eq(refunds.tenantId, tenantId))
    .orderBy(desc(refunds.createdAt));
}

export async function updateRefund(id: string, data: Partial<NewRefund>): Promise<Refund | null> {
  const [record] = await db
    .update(refunds)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(refunds.id, id))
    .returning();
  return record ?? null;
}

// ==========================================
// 9. Subscription Changes Repository Operations
// ==========================================

export async function createSubscriptionChange(
  data: NewSubscriptionChange,
): Promise<SubscriptionChange> {
  const [record] = await db.insert(subscriptionChanges).values(data).returning();
  if (!record) throw new Error('Failed to create subscription change record');
  return record;
}

export async function findSubscriptionChangesByTenant(
  tenantId: string,
): Promise<SubscriptionChange[]> {
  return db
    .select()
    .from(subscriptionChanges)
    .where(eq(subscriptionChanges.tenantId, tenantId))
    .orderBy(desc(subscriptionChanges.createdAt));
}

export const billingRepo = {
  findPlanByKey,
  findPlanById,
  findActivePublicPlans,
  findAllPlans,
  getPlanModuleKeys,
  createPlan,
  updatePlan,
  findEntitlementDefinitions,
  findPlanEntitlements,
  setPlanEntitlements,
  findTenantEntitlementOverrides,
  setTenantEntitlementOverride,
  removeTenantEntitlementOverride,
  findTenantSubscription,
  findTenantSubscriptionWithPlan,
  createSubscription,
  updateSubscription,
  createSubscriptionEvent,
  findSubscriptionEvents,
  listSubscriptionsForPlatform,
  getTenantUsage,
  setTenantUsageRecord,
  findBillingWebhook,
  createBillingWebhook,
  generateInvoiceNumber,
  createInvoice,
  findInvoiceById,
  findInvoicesByTenantId,
  listInvoicesForPlatform,
  updateInvoiceStatus,
  createPayment,
  findPaymentById,
  findPaymentByOrderId,
  findPaymentByPaymentId,
  updatePayment,
  findPaymentsByTenantId,
  listPaymentsForPlatform,
  createRefund,
  findRefundById,
  findRefundByProviderRefundId,
  findRefundsByPaymentId,
  findRefundsByTenantId,
  updateRefund,
  createSubscriptionChange,
  findSubscriptionChangesByTenant,
};
