import { eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { env } from '@/config/env';
import { tenants, type PlanLimits } from '@/db/schema';
import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import * as platformRepo from '@/modules/platform/platform.repository';
import * as rbacRepo from '@/modules/rbac/rbac.repository';
import { tenantBrandingRepo } from '@/modules/tenants/tenant-branding.repository';
import {
  getEffectiveUrlMode,
  type EffectiveUrlModeResult,
  type TenantUrlMode,
} from '@/modules/tenants/tenant-url.service';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';
import { emailQueue } from '@/queues/index';

import type {
  CreateInvoiceDto,
  CreatePlanDto,
  ListInvoicesQueryDto,
  ListPlansQueryDto,
  ListPlatformInvoicesQueryDto,
  SubscriptionChangeRequestDto,
  UpdatePlanDto,
  UpdateSubscriptionDto,
} from './billing.dto';
import * as billingRepo from './billing.repository';
import { DEFAULT_PLANS, DEFAULT_PLAN_KEY } from './plans.defaults';

const CACHE_KEYS = {
  PUBLIC_PLANS: 'plans:public',
  PLAN_BY_ID: (id: string) => `plans:id:${id}`,
  PLAN_BY_KEY: (key: string) => `plans:key:${key.toUpperCase()}`,
  TENANT_ENTITLEMENTS: (tenantId: string) => `entitlements:tenant:${tenantId}`,
};

export interface TenantEntitlements {
  planKey: string;
  planName: string;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  effectiveModules: string[];
  limits: PlanLimits;
  urlAccess: {
    path: true;
    subdomain: boolean;
    customDomain: boolean;
  };
  urlMode: TenantUrlMode;
  effectiveUrl?: EffectiveUrlModeResult;
}

export async function invalidateTenantBillingCache(tenantId: string): Promise<void> {
  await Promise.all([
    cache.del(CACHE_KEYS.TENANT_ENTITLEMENTS(tenantId)),
    cache.del(`entitlements:tenant:${tenantId}`),
    cache.del(`entitlements:${tenantId}`),
    cache.delByPrefix(`tenant:url:${tenantId}`),
    cache.delByPrefix('branding:resolve:'),
  ]);
}

/**
 * Service hook invoked whenever a tenant's plan or subscription state changes.
 * Keeps Tenant.plan denormalized column synchronized and handles URL mode transitions.
 */
export async function onPlanChanged(
  tenantId: string,
  oldPlanKey: string,
  newPlanKey: string,
): Promise<void> {
  // Sync Tenant.plan denormalized column
  await db
    .update(tenants)
    .set({ plan: newPlanKey, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  // Invalidate all billing and resolution caches
  await invalidateTenantBillingCache(tenantId);

  const oldRank = oldPlanKey === 'ENTERPRISE' ? 3 : oldPlanKey === 'PRO' ? 2 : 1;
  const newRank = newPlanKey === 'ENTERPRISE' ? 3 : newPlanKey === 'PRO' ? 2 : 1;

  const tenant = await tenantsRepo.findTenantById(tenantId);
  const tenantMembersList = await tenantsRepo.findTenantMembers(tenantId).catch(() => []);
  const activeMembers = tenantMembersList.filter((m) => m.status === 'ACTIVE');

  if (newRank > oldRank) {
    // Upgrade: Notify tenant admin of new URL capabilities without force-switching preferred URL
    for (const member of activeMembers.slice(0, 3)) {
      await emailQueue
        .add(
          'welcome',
          {
            to: member.email,
            name: member.name,
            subject: 'New workspace URL options available',
            message: `Your workspace "${tenant?.name ?? 'Workspace'}" has upgraded to ${newPlanKey}. You can now configure subdomains and custom branding in your Workspace Settings.`,
          },
          { jobId: `plan-upg-${tenantId}-${Date.now()}` },
        )
        .catch(() => {});
    }
  } else if (newRank < oldRank) {
    // Downgrade: keep existing config, effective URL automatically falls back to path
    for (const member of activeMembers.slice(0, 3)) {
      await emailQueue
        .add(
          'welcome',
          {
            to: member.email,
            name: member.name,
            subject: 'Notice: Workspace URL fallback',
            message: `Your workspace "${tenant?.name ?? 'Workspace'}" is now on the ${newPlanKey} plan. Workspace URL access has switched to the canonical path URL (${env.APP_BASE_DOMAIN}/w/${tenant?.slug}). Your custom domain configuration has been preserved.`,
          },
          { jobId: `plan-down-${tenantId}-${Date.now()}` },
        )
        .catch(() => {});
    }
  }
}

// ==========================================
// 1. Entitlements & Limits Enforcement
// ==========================================

export async function getTenantEntitlements(tenantId: string): Promise<TenantEntitlements> {
  return cache.wrap(CACHE_KEYS.TENANT_ENTITLEMENTS(tenantId), 300, async () => {
    const subWithPlan = await billingRepo.findTenantSubscriptionWithPlan(tenantId);
    let plan = subWithPlan?.plan;

    if (!plan) {
      // Fallback to tenant.plan or default FREE plan
      const tenant = await tenantsRepo.findTenantById(tenantId);
      const fallbackKey = (tenant?.plan || DEFAULT_PLAN_KEY).toUpperCase();
      plan = await billingRepo.findPlanByKey(fallbackKey);
      if (!plan) {
        plan = await billingRepo.findPlanByKey(DEFAULT_PLAN_KEY);
      }
      if (!plan) {
        const defaultDef =
          DEFAULT_PLANS.find((p) => p.key === fallbackKey) ??
          DEFAULT_PLANS.find((p) => p.key === DEFAULT_PLAN_KEY)!;
        plan = await billingRepo.createPlan(
          {
            key: defaultDef.key,
            name: defaultDef.name,
            description: defaultDef.description,
            priceMonthlyMinor: defaultDef.priceMonthlyMinor,
            priceYearlyMinor: defaultDef.priceYearlyMinor,
            currency: defaultDef.currency,
            trialDays: defaultDef.trialDays,
            limits: defaultDef.limits,
            isPublic: defaultDef.isPublic,
            isActive: defaultDef.isActive,
            sortOrder: defaultDef.sortOrder,
          },
          ['files', 'tenants', 'members', 'billing', 'rbac', 'audit'],
        );
      }
    }

    // Effective modules = plan modules ∖ explicitly disabled tenant modules
    const disabledModules = await rbacRepo.findDisabledTenantModules(tenantId);
    const disabledKeys = new Set(disabledModules.map((m) => m.key));
    const effectiveModules = (plan.modules ?? []).filter((modKey) => !disabledKeys.has(modKey));

    const rawLimits = plan.limits;
    const urlAccess = rawLimits?.urlAccess ?? {
      path: true as const,
      subdomain: plan.key === 'PRO' || plan.key === 'ENTERPRISE',
      customDomain: plan.key === 'ENTERPRISE',
    };
    const limitsWithUrl: PlanLimits = {
      ...rawLimits,
      urlAccess,
    };

    const tenant = await tenantsRepo.findTenantById(tenantId);
    const branding = tenant ? await tenantBrandingRepo.findBrandingByTenantId(tenantId) : null;
    const effectiveUrl = tenant
      ? getEffectiveUrlMode(
          tenant,
          branding,
          {
            limits: limitsWithUrl,
            subscriptionStatus: subWithPlan?.status ?? 'ACTIVE',
          },
          env,
        )
      : undefined;

    return {
      planKey: plan.key,
      planName: plan.name,
      subscriptionStatus: subWithPlan?.status ?? 'ACTIVE',
      trialEndsAt: subWithPlan?.trialEndsAt ?? null,
      effectiveModules,
      limits: limitsWithUrl,
      urlAccess,
      urlMode: effectiveUrl?.mode ?? 'path',
      effectiveUrl,
    };
  });
}

export async function enforceLimit(
  tenantId: string,
  limitKey: 'maxMembers' | 'maxCustomRoles' | 'maxStorageBytes',
  projectedIncrement = 1,
): Promise<void> {
  const entitlements = await getTenantEntitlements(tenantId);
  const quota = entitlements.limits[limitKey];

  if (quota === null || quota === undefined) {
    return; // Unlimited quota
  }

  const usage = await billingRepo.getTenantUsage(tenantId);
  let currentUsage = 0;
  if (limitKey === 'maxMembers') currentUsage = usage.members;
  else if (limitKey === 'maxCustomRoles') currentUsage = usage.customRoles;
  else if (limitKey === 'maxStorageBytes') currentUsage = usage.storageBytes;

  if (currentUsage + projectedIncrement > quota) {
    throw new AppError(
      403,
      `Workspace quota exceeded for ${limitKey} on your current plan. Please upgrade to continue.`,
      'PLAN_LIMIT_REACHED',
      { limit: quota, current: currentUsage, projectedIncrement, limitKey },
    );
  }
}

// ==========================================
// 2. Plans Catalog (Platform Staff & Public)
// ==========================================

export async function listPublicPlans() {
  return cache.wrap(CACHE_KEYS.PUBLIC_PLANS, 300, async () => {
    const plans = await billingRepo.findAllPlans({ includeInactive: false });
    return plans.filter((p) => p.isPublic);
  });
}

export async function listPlatformPlans(query?: ListPlansQueryDto) {
  return billingRepo.findAllPlans(query);
}

export const listAllPlans = listPlatformPlans;

export async function getPlanById(id: string) {
  return cache.wrap(CACHE_KEYS.PLAN_BY_ID(id), 300, async () => {
    const plan = await billingRepo.findPlanById(id);
    if (!plan) throw AppError.notFound('Plan not found');
    return plan;
  });
}

export async function createPlan(actorStaffId: string, dto: CreatePlanDto, requestId?: string) {
  const existing = await billingRepo.findPlanByKey(dto.key);
  if (existing) {
    throw AppError.conflict(`A plan with key "${dto.key}" already exists`);
  }

  const { moduleKeys, ...planFields } = dto;
  const created = await billingRepo.createPlan(
    {
      ...planFields,
      limits: dto.limits,
    },
    moduleKeys,
  );

  await cache.del(CACHE_KEYS.PUBLIC_PLANS);

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'plan.created',
    targetType: 'plan',
    targetId: created.id,
    metadata: { key: created.key, name: created.name },
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
  const existing = await billingRepo.findPlanById(id);
  if (!existing) throw AppError.notFound('Plan not found');

  const { moduleKeys, ...planFields } = dto;
  const updated = await billingRepo.updatePlan(
    id,
    planFields,
    moduleKeys,
  );

  await cache.del(CACHE_KEYS.PUBLIC_PLANS);
  await cache.del(CACHE_KEYS.PLAN_BY_ID(id));
  await cache.del(CACHE_KEYS.PLAN_BY_KEY(existing.key));
  await cache.delByPrefix('entitlements:');
  await cache.delByPrefix('branding:resolve:');
  await cache.delByPrefix('tenant:url:');

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'plan.updated',
    targetType: 'plan',
    targetId: id,
    metadata: { changes: Object.keys(dto) },
    requestId,
  });

  return updated;
}

// ==========================================
// 3. Subscription Management (Platform & Tenant)
// ==========================================

export async function getPlatformTenantSubscription(tenantId: string) {
  const sub = await billingRepo.findTenantSubscriptionWithPlan(tenantId);
  const usage = await billingRepo.getTenantUsage(tenantId);
  const events = await billingRepo.findSubscriptionEvents(tenantId);

  return {
    subscription: sub,
    usage,
    events,
  };
}

export async function updatePlatformTenantSubscription(
  actorStaffId: string,
  tenantId: string,
  dto: UpdateSubscriptionDto,
  requestId?: string,
) {
  let sub = await billingRepo.findTenantSubscription(tenantId);
  let targetPlanId = sub?.planId;
  const fromPlanId = sub?.planId;

  if (dto.planKey) {
    const targetPlan = await billingRepo.findPlanByKey(dto.planKey);
    if (!targetPlan) throw AppError.notFound(`Target plan "${dto.planKey}" not found`);
    targetPlanId = targetPlan.id;
  }

  if (!sub) {
    if (!targetPlanId) {
      const freePlan = await billingRepo.findPlanByKey(DEFAULT_PLAN_KEY);
      targetPlanId = freePlan!.id;
    }
    sub = await billingRepo.createSubscription({
      tenantId,
      planId: targetPlanId,
      status: dto.status ?? 'ACTIVE',
      currentPeriodStart: dto.currentPeriodStart ?? new Date(),
      currentPeriodEnd: dto.currentPeriodEnd,
      trialEndsAt: dto.trialEndsAt,
      cancelAtPeriodEnd: dto.cancelAtPeriodEnd ?? false,
      provider: 'manual',
    });
  } else {
    sub = await billingRepo.updateSubscription(sub.id, {
      ...(targetPlanId ? { planId: targetPlanId } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.currentPeriodStart ? { currentPeriodStart: dto.currentPeriodStart } : {}),
      ...(dto.currentPeriodEnd !== undefined ? { currentPeriodEnd: dto.currentPeriodEnd } : {}),
      ...(dto.trialEndsAt !== undefined ? { trialEndsAt: dto.trialEndsAt } : {}),
      ...(dto.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: dto.cancelAtPeriodEnd } : {}),
    });
  }

  const oldPlan = fromPlanId ? await billingRepo.findPlanById(fromPlanId) : null;
  const newPlan = targetPlanId ? await billingRepo.findPlanById(targetPlanId) : null;

  if (newPlan) {
    await db
      .update(tenants)
      .set({ plan: newPlan.key, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
  }

  await billingRepo.createSubscriptionEvent({
    subscriptionId: sub!.id,
    tenantId,
    type: 'UPDATED',
    fromPlanId,
    toPlanId: targetPlanId,
    actorType: 'PLATFORM_STAFF',
    actorId: actorStaffId,
    metadata: { dto },
  });

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.subscription_updated',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    metadata: { dto },
    requestId,
  });

  if (oldPlan && newPlan && oldPlan.key !== newPlan.key) {
    await onPlanChanged(tenantId, oldPlan.key, newPlan.key);
  } else {
    await invalidateTenantBillingCache(tenantId);
  }

  return billingRepo.findTenantSubscriptionWithPlan(tenantId);
}

export async function getTenantBillingOverview(tenantId: string) {
  const sub = await billingRepo.findTenantSubscriptionWithPlan(tenantId);
  const entitlements = await getTenantEntitlements(tenantId);
  const usage = await billingRepo.getTenantUsage(tenantId);
  const events = await billingRepo.findSubscriptionEvents(tenantId);

  return {
    subscription: sub,
    plan: {
      key: entitlements.planKey,
      name: entitlements.planName,
      limits: entitlements.limits,
      effectiveModules: entitlements.effectiveModules,
    },
    usage,
    limits: entitlements.limits,
    recentEvents: events.slice(0, 5),
  };
}

export async function requestSubscriptionChange(
  tenantId: string,
  actorUserId: string,
  dto: SubscriptionChangeRequestDto,
) {
  const sub = await billingRepo.findTenantSubscription(tenantId);
  if (!sub) throw AppError.notFound('Tenant subscription not found');

  const targetPlan = await billingRepo.findPlanByKey(dto.targetPlanKey);
  if (!targetPlan) throw AppError.notFound(`Target plan "${dto.targetPlanKey}" not found`);

  const event = await billingRepo.createSubscriptionEvent({
    subscriptionId: sub.id,
    tenantId,
    type: 'CHANGE_REQUESTED',
    fromPlanId: sub.planId,
    toPlanId: targetPlan.id,
    actorType: 'USER',
    actorId: actorUserId,
    metadata: {
      targetPlanKey: dto.targetPlanKey,
      reason: dto.reason,
      requestedAt: new Date().toISOString(),
    },
  });

  return {
    success: true,
    message: 'Subscription change request submitted successfully. Our operations team has been notified.',
    event,
  };
}

// ==========================================
// 4. Invoices Management
// ==========================================

export async function getTenantInvoices(tenantId: string, query?: ListInvoicesQueryDto) {
  return billingRepo.findInvoicesByTenantId(tenantId, query);
}

export async function getTenantInvoiceById(tenantId: string, invoiceId: string) {
  const invoice = await billingRepo.findInvoiceById(invoiceId);
  if (!invoice || invoice.tenantId !== tenantId) {
    throw AppError.notFound('Invoice not found');
  }
  return invoice;
}

export async function listPlatformInvoices(query?: ListPlatformInvoicesQueryDto) {
  return billingRepo.listInvoicesForPlatform(query);
}

export async function getPlatformInvoiceById(invoiceId: string) {
  const invoice = await billingRepo.findInvoiceById(invoiceId);
  if (!invoice) throw AppError.notFound('Invoice not found');
  return invoice;
}

export async function createPlatformInvoice(
  actorStaffId: string,
  dto: CreateInvoiceDto,
  requestId?: string,
) {
  const created = await billingRepo.createInvoice({
    tenantId: dto.tenantId,
    planId: dto.planId,
    subscriptionId: dto.subscriptionId,
    amountCents: dto.amountCents,
    taxCents: dto.taxCents,
    currency: dto.currency,
    lineItems: dto.lineItems,
    billingPeriodStart: dto.billingPeriodStart,
    billingPeriodEnd: dto.billingPeriodEnd,
    dueDate: dto.dueDate,
    status: dto.status,
  });

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'invoice.created',
    targetType: 'invoice',
    targetId: created.id,
    tenantId: dto.tenantId,
    metadata: { invoiceNumber: created.invoiceNumber, totalCents: created.totalCents },
    requestId,
  });

  return created;
}

export async function updateInvoiceStatus(
  actorStaffId: string,
  invoiceId: string,
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTABLE',
  paidAt?: Date,
  requestId?: string,
) {
  const updated = await billingRepo.updateInvoiceStatus(invoiceId, status, paidAt);
  if (!updated) throw AppError.notFound('Invoice not found');

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'invoice.status_updated',
    targetType: 'invoice',
    targetId: invoiceId,
    tenantId: updated.tenantId,
    metadata: { status, paidAt },
    requestId,
  });

  return updated;
}

export async function seedDefaultPlans(): Promise<void> {
  for (const def of DEFAULT_PLANS) {
    const existing = await billingRepo.findPlanByKey(def.key);
    if (!existing) {
      await billingRepo.createPlan({
        key: def.key,
        name: def.name,
        description: def.description,
        priceMonthlyMinor: def.priceMonthlyMinor,
        priceYearlyMinor: def.priceYearlyMinor,
        currency: def.currency,
        trialDays: def.trialDays,
        limits: def.limits,
        isPublic: def.isPublic,
        isActive: def.isActive,
        sortOrder: def.sortOrder,
      });
    }
  }
}

export async function assignInitialSubscription(tenantId: string, planKey = DEFAULT_PLAN_KEY) {
  const plan = await billingRepo.findPlanByKey(planKey);
  if (!plan) return null;
  const trialEndsAt = new Date(Date.now() + (plan.trialDays ?? 14) * 86400000);
  return billingRepo.createSubscription({
    tenantId,
    planId: plan.id,
    status: 'TRIALING',
    trialEndsAt,
    currentPeriodStart: new Date(),
    currentPeriodEnd: trialEndsAt,
    provider: 'manual',
  });
}
