import { and, count, eq, inArray } from 'drizzle-orm';

import { db } from '@/config/db.js';
import {
  planEntitlements,
  plans,
  subscriptions,
  tenantMembers,
  type NewPlan,
  type NewPlanEntitlement,
  type NewSubscription,
  type Plan,
  type PlanEntitlement,
  type Subscription,
} from '@/db/schema/index.js';

export interface PlanWithEntitlements extends Plan {
  entitlements: PlanEntitlement | null;
}

export interface SubscriptionWithPlan extends Subscription {
  plan: PlanWithEntitlements | null;
}

export async function findActivePublicPlans(): Promise<PlanWithEntitlements[]> {
  const rows = await db
    .select({
      plan: plans,
      entitlement: planEntitlements,
    })
    .from(plans)
    .leftJoin(planEntitlements, eq(planEntitlements.planId, plans.id))
    .where(and(eq(plans.isActive, true), eq(plans.isPublic, true)))
    .orderBy(plans.priceCents);

  return (rows ?? []).map((r) => ({
    ...r.plan,
    entitlements: r.entitlement ?? null,
  }));
}

export async function findAllPlans(options?: {
  includeInactive?: boolean;
}): Promise<PlanWithEntitlements[]> {
  const query = db
    .select({
      plan: plans,
      entitlement: planEntitlements,
    })
    .from(plans)
    .leftJoin(planEntitlements, eq(planEntitlements.planId, plans.id));

  if (!options?.includeInactive) {
    query.where(eq(plans.isActive, true));
  }

  const rows = await query.orderBy(plans.priceCents);
  return (rows ?? []).map((r) => ({
    ...r.plan,
    entitlements: r.entitlement ?? null,
  }));
}

export async function findPlanById(id: string): Promise<PlanWithEntitlements | null> {
  const [row] = await db
    .select({
      plan: plans,
      entitlement: planEntitlements,
    })
    .from(plans)
    .leftJoin(planEntitlements, eq(planEntitlements.planId, plans.id))
    .where(eq(plans.id, id))
    .limit(1);

  if (!row) return null;
  return {
    ...row.plan,
    entitlements: row.entitlement ?? null,
  };
}

export async function findPlanByKey(key: string): Promise<PlanWithEntitlements | null> {
  const [row] = await db
    .select({
      plan: plans,
      entitlement: planEntitlements,
    })
    .from(plans)
    .leftJoin(planEntitlements, eq(planEntitlements.planId, plans.id))
    .where(eq(plans.key, key.toUpperCase()))
    .limit(1);

  if (!row) return null;
  return {
    ...row.plan,
    entitlements: row.entitlement ?? null,
  };
}

export async function createPlan(
  planData: NewPlan,
  entitlementsData?: Partial<NewPlanEntitlement>,
): Promise<PlanWithEntitlements> {
  return db.transaction(async (tx) => {
    const [createdPlan] = await tx.insert(plans).values(planData).returning();
    if (!createdPlan) throw new Error('Failed to create plan');

    const [createdEntitlements] = await tx
      .insert(planEntitlements)
      .values({
        planId: createdPlan.id,
        maxMembers: entitlementsData?.maxMembers ?? 5,
        maxProjects: entitlementsData?.maxProjects ?? 10,
        maxStorageMb: entitlementsData?.maxStorageMb ?? 1024,
        hasCustomRoles: entitlementsData?.hasCustomRoles ?? false,
        hasAdvancedAnalytics: entitlementsData?.hasAdvancedAnalytics ?? false,
        hasPrioritySupport: entitlementsData?.hasPrioritySupport ?? false,
        hasAuditRetentionDays: entitlementsData?.hasAuditRetentionDays ?? 7,
      })
      .returning();

    return {
      ...createdPlan,
      entitlements: createdEntitlements ?? null,
    };
  });
}

export async function updatePlan(
  id: string,
  planData: Partial<NewPlan>,
  entitlementsData?: Partial<NewPlanEntitlement>,
): Promise<PlanWithEntitlements | null> {
  return db.transaction(async (tx) => {
    let updatedPlan: Plan | undefined;

    if (Object.keys(planData ?? {}).length > 0) {
      const [res] = await tx.update(plans).set(planData).where(eq(plans.id, id)).returning();
      updatedPlan = res;
    } else {
      const [res] = await tx.select().from(plans).where(eq(plans.id, id)).limit(1);
      updatedPlan = res;
    }

    if (!updatedPlan) return null;

    let updatedEntitlement: PlanEntitlement | undefined;
    if (entitlementsData && Object.keys(entitlementsData).length > 0) {
      const [res] = await tx
        .update(planEntitlements)
        .set(entitlementsData)
        .where(eq(planEntitlements.planId, id))
        .returning();
      updatedEntitlement = res;
    } else {
      const [res] = await tx
        .select()
        .from(planEntitlements)
        .where(eq(planEntitlements.planId, id))
        .limit(1);
      updatedEntitlement = res;
    }

    return {
      ...updatedPlan,
      entitlements: updatedEntitlement ?? null,
    };
  });
}

export async function findSubscriptionByTenantId(
  tenantId: string,
): Promise<SubscriptionWithPlan | null> {
  const [row] = await db
    .select({
      sub: subscriptions,
      plan: plans,
      entitlement: planEntitlements,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .leftJoin(planEntitlements, eq(planEntitlements.planId, plans.id))
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);

  if (!row) return null;

  return {
    ...row.sub,
    plan: {
      ...row.plan,
      entitlements: row.entitlement ?? null,
    },
  };
}

export async function upsertSubscription(subData: NewSubscription): Promise<Subscription> {
  const [upserted] = await db
    .insert(subscriptions)
    .values(subData)
    .onConflictDoUpdate({
      target: subscriptions.tenantId,
      set: {
        planId: subData.planId,
        status: subData.status ?? 'ACTIVE',
        seatCount: subData.seatCount ?? 1,
        currentPeriodStart: subData.currentPeriodStart ?? new Date(),
        currentPeriodEnd: subData.currentPeriodEnd,
        cancelAtPeriodEnd: subData.cancelAtPeriodEnd ?? false,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!upserted) throw new Error('Failed to upsert subscription');
  return upserted;
}

export async function countActiveTenantMembers(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenantId, tenantId),
        inArray(tenantMembers.status, ['ACTIVE', 'INVITED']),
      ),
    );

  return Number(row?.count ?? 0);
}
