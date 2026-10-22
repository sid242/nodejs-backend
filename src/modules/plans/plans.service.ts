import { eq } from 'drizzle-orm';

import { db } from '@/config/db.js';
import { tenants } from '@/db/schema/index.js';
import { cache } from '@/lib/cache.js';
import { AppError } from '@/lib/errors.js';
import { logSecurityEvent } from '@/modules/audit/audit.service.js';
import * as platformRepo from '@/modules/platform/platform.repository.js';

import type {
  ChangeSubscriptionDto,
  CreatePlanDto,
  ListPlansQueryDto,
  UpdatePlanDto,
} from './plans.dto.js';
import * as plansRepo from './plans.repository.js';

const CACHE_KEYS = {
  PUBLIC_PLANS: 'plans:public',
  PLAN_BY_ID: (id: string) => `plans:id:${id}`,
  PLAN_BY_KEY: (key: string) => `plans:key:${key.toUpperCase()}`,
  TENANT_SUB: (tenantId: string) => `subscriptions:tenant:${tenantId}`,
};

export async function listPublicPlans() {
  return cache.wrap(CACHE_KEYS.PUBLIC_PLANS, 300, async () => {
    return plansRepo.findActivePublicPlans();
  });
}

export async function listAllPlans(query?: ListPlansQueryDto) {
  return plansRepo.findAllPlans({
    includeInactive: query?.includeInactive ?? false,
  });
}

export async function getPlanById(id: string) {
  return cache.wrap(CACHE_KEYS.PLAN_BY_ID(id), 300, async () => {
    const plan = await plansRepo.findPlanById(id);
    if (!plan) throw AppError.notFound('Plan not found');
    return plan;
  });
}

export async function getPlanByKey(key: string) {
  return cache.wrap(CACHE_KEYS.PLAN_BY_KEY(key), 300, async () => {
    const plan = await plansRepo.findPlanByKey(key);
    if (!plan) throw AppError.notFound(`Plan with key "${key}" not found`);
    return plan;
  });
}

export async function createPlan(actorStaffId: string, dto: CreatePlanDto, requestId?: string) {
  const existing = await plansRepo.findPlanByKey(dto.key);
  if (existing) {
    throw AppError.conflict(`A plan with key "${dto.key}" already exists`);
  }

  const { entitlements, ...planFields } = dto;
  const created = await plansRepo.createPlan(planFields, entitlements);

  await cache.del(CACHE_KEYS.PUBLIC_PLANS);

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'plan.created',
    targetType: 'plan',
    targetId: created.id,
    metadata: { key: created.key, name: created.name, priceCents: created.priceCents },
    requestId,
  });

  return created;
}

export async function updatePlan(
  actorStaffId: string,
  id: string,
  dto: UpdatePlanDto,
  requestId?: string,
) {
  const plan = await plansRepo.findPlanById(id);
  if (!plan) throw AppError.notFound('Plan not found');

  const { entitlements, ...planFields } = dto;
  const updated = await plansRepo.updatePlan(id, planFields, entitlements);
  if (!updated) throw AppError.notFound('Plan not found');

  await cache.del(CACHE_KEYS.PUBLIC_PLANS);
  await cache.del(CACHE_KEYS.PLAN_BY_ID(id));
  await cache.del(CACHE_KEYS.PLAN_BY_KEY(plan.key));

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'plan.updated',
    targetType: 'plan',
    targetId: updated.id,
    metadata: { key: updated.key, changedFields: Object.keys(dto) },
    requestId,
  });

  return updated;
}

export async function getTenantSubscription(tenantId: string) {
  const memberCount = await plansRepo.countActiveTenantMembers(tenantId);
  const sub = await plansRepo.findSubscriptionByTenantId(tenantId);

  if (!sub) {
    // If tenant has no explicit subscription yet, resolve standard 'FREE' plan
    let freePlan = await plansRepo.findPlanByKey('FREE');
    if (!freePlan) {
      await seedDefaultPlans();
      freePlan = await plansRepo.findPlanByKey('FREE');
    }

    const maxMembers = freePlan?.entitlements?.maxMembers ?? 5;
    return {
      id: null,
      tenantId,
      status: 'ACTIVE',
      seatCount: 1,
      currentPeriodStart: new Date(),
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      plan: freePlan,
      usage: {
        activeMembers: memberCount,
        maxMembers,
        remainingSeats: Math.max(0, maxMembers - memberCount),
      },
    };
  }

  const maxMembers = sub?.plan?.entitlements?.maxMembers ?? 5;
  return {
    ...sub,
    usage: {
      activeMembers: memberCount,
      maxMembers,
      remainingSeats: Math.max(0, maxMembers - memberCount),
    },
  };
}

export async function checkTenantSeatLimit(tenantId: string): Promise<void> {
  const memberCount = await plansRepo.countActiveTenantMembers(tenantId);
  const sub = await plansRepo.findSubscriptionByTenantId(tenantId);

  let maxMembers = 5;
  let planName = 'Free Tier';

  if (sub?.plan?.entitlements?.maxMembers) {
    maxMembers = sub.plan.entitlements.maxMembers;
    planName = sub.plan.name;
  } else {
    const freePlan = await plansRepo.findPlanByKey('FREE');
    if (freePlan?.entitlements?.maxMembers) {
      maxMembers = freePlan.entitlements.maxMembers;
      planName = freePlan.name;
    }
  }

  if (memberCount >= maxMembers) {
    throw AppError.forbidden(
      `Plan seat limit reached (${memberCount}/${maxMembers} members on ${planName}). Please upgrade your workspace plan to invite more team members.`,
      {
        currentMembers: memberCount,
        maxMembers,
        planName,
      },
    );
  }
}

export async function changeTenantSubscription(
  tenantId: string,
  dto: ChangeSubscriptionDto,
  operatorUserId?: string,
) {
  const targetPlan = await plansRepo.findPlanByKey(dto.planKey);
  if (!targetPlan || !targetPlan.isActive) {
    throw AppError.badRequest(`Plan "${dto.planKey}" is not valid or no longer active`);
  }

  const currentMembers = await plansRepo.countActiveTenantMembers(tenantId);
  const targetMaxMembers = targetPlan.entitlements?.maxMembers ?? 5;

  if (currentMembers > targetMaxMembers) {
    throw AppError.badRequest(
      `Cannot downgrade to ${targetPlan.name}: your workspace currently has ${currentMembers} members, which exceeds this plan's limit of ${targetMaxMembers} seats.`,
      { currentMembers, targetMaxMembers },
    );
  }

  // Upsert subscription
  const periodStart = new Date();
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const updatedSub = await plansRepo.upsertSubscription({
    tenantId,
    planId: targetPlan.id,
    status: 'ACTIVE',
    seatCount: dto.seatCount ?? 1,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    provider: 'MOCK',
  });

  // Keep tenants.plan in sync
  await db.update(tenants).set({ plan: targetPlan.key }).where(eq(tenants.id, tenantId));

  await cache.del(CACHE_KEYS.TENANT_SUB(tenantId));

  if (operatorUserId) {
    await logSecurityEvent({
      tenantId,
      userId: operatorUserId,
      action: 'SUBSCRIPTION.UPDATED',
      entityType: 'Subscription',
      entityId: updatedSub.id,
      metadata: {
        newPlanKey: targetPlan.key,
        newPlanName: targetPlan.name,
        priceCents: targetPlan.priceCents,
      },
    });
  }

  return getTenantSubscription(tenantId);
}

export async function assignInitialSubscription(tenantId: string, planKey = 'FREE') {
  let plan = await plansRepo.findPlanByKey(planKey);
  if (!plan) {
    await seedDefaultPlans();
    plan = await plansRepo.findPlanByKey(planKey);
  }
  if (!plan) return null;

  return plansRepo.upsertSubscription({
    tenantId,
    planId: plan.id,
    status: 'ACTIVE',
    seatCount: 1,
    currentPeriodStart: new Date(),
    provider: 'MOCK',
  });
}

export async function seedDefaultPlans(): Promise<void> {
  const defaults = [
    {
      key: 'FREE',
      name: 'Free Tier',
      description: 'Ideal for early-stage teams testing core features and workflows.',
      priceCents: 0,
      currency: 'USD',
      billingInterval: 'MONTHLY' as const,
      isActive: true,
      isPublic: true,
      entitlements: {
        maxMembers: 5,
        maxProjects: 10,
        maxStorageMb: 1024, // 1 GB
        hasCustomRoles: false,
        hasAdvancedAnalytics: false,
        hasPrioritySupport: false,
        hasAuditRetentionDays: 7,
      },
    },
    {
      key: 'STARTER',
      name: 'Starter Plan',
      description: 'Built for growing teams requiring custom RBAC and higher storage limits.',
      priceCents: 2900,
      currency: 'USD',
      billingInterval: 'MONTHLY' as const,
      isActive: true,
      isPublic: true,
      entitlements: {
        maxMembers: 15,
        maxProjects: 50,
        maxStorageMb: 10240, // 10 GB
        hasCustomRoles: true,
        hasAdvancedAnalytics: false,
        hasPrioritySupport: false,
        hasAuditRetentionDays: 30,
      },
    },
    {
      key: 'GROWTH',
      name: 'Growth Plan',
      description:
        'Designed for scaling operations demanding advanced analytics and deep security.',
      priceCents: 9900,
      currency: 'USD',
      billingInterval: 'MONTHLY' as const,
      isActive: true,
      isPublic: true,
      entitlements: {
        maxMembers: 50,
        maxProjects: 200,
        maxStorageMb: 51200, // 50 GB
        hasCustomRoles: true,
        hasAdvancedAnalytics: true,
        hasPrioritySupport: true,
        hasAuditRetentionDays: 90,
      },
    },
    {
      key: 'ENTERPRISE',
      name: 'Enterprise Tier',
      description: 'Full custom governance, dedicated isolation, and 1-year compliance audits.',
      priceCents: 29900,
      currency: 'USD',
      billingInterval: 'MONTHLY' as const,
      isActive: true,
      isPublic: true,
      entitlements: {
        maxMembers: 500,
        maxProjects: 10000,
        maxStorageMb: 1048576, // 1 TB
        hasCustomRoles: true,
        hasAdvancedAnalytics: true,
        hasPrioritySupport: true,
        hasAuditRetentionDays: 365,
      },
    },
  ];

  for (const p of defaults) {
    const existing = await plansRepo.findPlanByKey(p.key);
    if (!existing) {
      const { entitlements, ...planFields } = p;
      await plansRepo.createPlan(planFields, entitlements);
    }
  }
}
