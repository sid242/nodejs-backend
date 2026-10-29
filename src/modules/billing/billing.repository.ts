import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import {
  appModules,
  files,
  invoices,
  planModules,
  plans,
  roles,
  subscriptionEvents,
  subscriptions,
  tenantInvitations,
  tenantMembers,
  tenants,
  type Invoice,
  type NewInvoice,
  type NewPlan,
  type NewSubscription,
  type NewSubscriptionEvent,
  type Plan,
  type Subscription,
  type SubscriptionEvent,
} from '@/db/schema';

export interface PlanWithModules extends Plan {
  modules: string[];
}

export interface SubscriptionWithPlan extends Subscription {
  plan: PlanWithModules | null;
}

export interface TenantUsage {
  members: number;
  storageBytes: number;
  customRoles: number;
}

export interface InvoiceWithDetails extends Invoice {
  tenantName?: string;
  planName?: string | null;
}

// ==========================================
// 1. Plan Repository Operations
// ==========================================

export async function findPlanByKey(key: string): Promise<PlanWithModules | null> {
  const [record] = await db
    .select()
    .from(plans)
    .where(eq(plans.key, key.toUpperCase()))
    .limit(1);

  if (!record) return null;
  const modules = await getPlanModuleKeys(record.id);
  return { ...record, modules };
}

export async function findPlanById(id: string): Promise<PlanWithModules | null> {
  const [record] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  if (!record) return null;
  const modules = await getPlanModuleKeys(record.id);
  return { ...record, modules };
}

export async function findActivePublicPlans(): Promise<PlanWithModules[]> {
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.isActive, true), eq(plans.isPublic, true)))
    .orderBy(plans.sortOrder, plans.priceMonthlyMinor);

  return Promise.all(
    (rows ?? []).map(async (p) => ({
      ...p,
      modules: await getPlanModuleKeys(p.id),
    })),
  );
}

export async function findAllPlans(options?: {
  includeInactive?: boolean;
}): Promise<PlanWithModules[]> {
  const query = db.select().from(plans);
  if (!options?.includeInactive) {
    query.where(eq(plans.isActive, true));
  }
  const rows = await query.orderBy(plans.sortOrder, plans.priceMonthlyMinor);

  return Promise.all(
    (rows ?? []).map(async (p) => ({
      ...p,
      modules: await getPlanModuleKeys(p.id),
    })),
  );
}

export async function getPlanModuleKeys(planId: string): Promise<string[]> {
  const rows = await db
    .select({ key: appModules.key })
    .from(planModules)
    .innerJoin(appModules, eq(planModules.moduleId, appModules.id))
    .where(eq(planModules.planId, planId));

  return (rows ?? []).map((r) => r.key);
}

export async function createPlan(data: NewPlan, moduleKeys?: string[]): Promise<PlanWithModules> {
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

    const modules = await tx
      .select({ key: appModules.key })
      .from(planModules)
      .innerJoin(appModules, eq(planModules.moduleId, appModules.id))
      .where(eq(planModules.planId, record.id));

    return { ...record, modules: modules.map((m) => m.key) };
  });
}

export async function updatePlan(
  id: string,
  data: Partial<NewPlan>,
  moduleKeys?: string[],
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

    const modules = await tx
      .select({ key: appModules.key })
      .from(planModules)
      .innerJoin(appModules, eq(planModules.moduleId, appModules.id))
      .where(eq(planModules.planId, id));

    return { ...record, modules: modules.map((m) => m.key) };
  });
}

// ==========================================
// 2. Subscription Repository Operations
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

export async function createSubscription(
  data: NewSubscription,
  tx?: any,
): Promise<Subscription> {
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

// ==========================================
// 3. Usage & Quotas Calculation
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

  const membersCount =
    Number(activeMembersRow?.total ?? 0) + Number(pendingInvitesRow?.total ?? 0);

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

  return {
    members: membersCount,
    storageBytes,
    customRoles: customRolesCount,
  };
}

// ==========================================
// 4. Invoices Repository Operations
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
      amountCents,
      taxCents,
      totalCents,
    })
    .returning();

  return record!;
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
  options?: { page?: number; limit?: number; status?: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTABLE' },
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
