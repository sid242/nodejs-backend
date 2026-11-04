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
  AssignSubscriptionDto,
  BillingWebhookDto,
  CreateInvoiceDto,
  CreatePlanDto,
  ListInvoicesQueryDto,
  ListPlansQueryDto,
  ListPlatformInvoicesQueryDto,
  ListPlatformSubscriptionsQueryDto,
  SetTenantEntitlementOverrideDto,
  SubscriptionChangeRequestDto,
  UpdatePlanDto,
  UpdateSubscriptionDto,
} from './billing.dto';
import { billingRepo } from './billing.repository';
import {
  DEFAULT_ENTITLEMENT_DEFINITIONS,
  DEFAULT_PLAN_ENTITLEMENT_VALUES,
} from './entitlements.defaults';
import { DEFAULT_PLANS, DEFAULT_PLAN_KEY } from './plans.defaults';

const CACHE_KEYS = {
  PUBLIC_PLANS: 'plans:public',
  PLAN_BY_ID: (id: string) => `plans:id:${id}`,
  PLAN_BY_KEY: (key: string) => `plans:key:${key.toUpperCase()}`,
  TENANT_ENTITLEMENTS: (tenantId: string) => `entitlements:tenant:${tenantId}`,
};

export interface EntitlementItem {
  value: any;
  source: 'OVERRIDE' | 'PLAN' | 'DEFAULT';
  type: string;
  unit?: string | null;
  expiresAt?: Date | null;
  reason?: string | null;
}

export interface TenantEntitlements {
  planKey: string;
  planName: string;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  seatCount: number;
  effectiveModules: string[];
  limits: PlanLimits;
  entitlements: Record<string, EntitlementItem>;
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

    // 1. Fetch definitions, plan entitlements, and active overrides
    const [definitions, planEnts, overrides] = await Promise.all([
      billingRepo.findEntitlementDefinitions(),
      billingRepo.findPlanEntitlements(plan.id),
      billingRepo.findTenantEntitlementOverrides(tenantId),
    ]);

    const overrideMap = new Map<string, (typeof overrides)[0]>();
    for (const ov of overrides ?? []) {
      overrideMap.set(ov.entitlementKey, ov);
    }

    const entitlementsResult: Record<string, EntitlementItem> = {};

    for (const def of definitions) {
      const activeOverride = overrideMap.get(def.key);
      if (activeOverride) {
        entitlementsResult[def.key] = {
          value: activeOverride.value,
          source: 'OVERRIDE',
          type: def.type,
          unit: def.unit,
          expiresAt: activeOverride.expiresAt,
          reason: activeOverride.reason,
        };
      } else if (planEnts[def.key] !== undefined) {
        entitlementsResult[def.key] = {
          value: planEnts[def.key],
          source: 'PLAN',
          type: def.type,
          unit: def.unit,
        };
      } else if (DEFAULT_PLAN_ENTITLEMENT_VALUES?.[plan.key]?.[def.key] !== undefined) {
        entitlementsResult[def.key] = {
          value: DEFAULT_PLAN_ENTITLEMENT_VALUES?.[plan.key]?.[def.key] as string | number | boolean,
          source: 'PLAN',
          type: def.type,
          unit: def.unit,
        };
      } else if (plan.entitlements?.[def.key] !== undefined) {
        entitlementsResult[def.key] = {
          value: plan.entitlements[def.key],
          source: 'PLAN',
          type: def.type,
          unit: def.unit,
        };
      } else {
        entitlementsResult[def.key] = {
          value: def.defaultValue,
          source: 'DEFAULT',
          type: def.type,
          unit: def.unit,
        };
      }
    }

    // Effective modules = plan modules ∖ explicitly disabled tenant modules
    const disabledModules = await rbacRepo.findDisabledTenantModules(tenantId);
    const disabledKeys = new Set(disabledModules.map((m) => m.key));
    const effectiveModules = (plan.modules ?? []).filter((modKey) => !disabledKeys.has(modKey));

    const rawLimits = plan.limits;
    const maxMembers = Number(
      entitlementsResult['members.max']?.value ?? rawLimits?.maxMembers ?? 5,
    );
    const maxStorageGb = Number(entitlementsResult['storage.gb']?.value ?? 1);
    const maxCustomRoles = Number(
      entitlementsResult['custom_roles.max']?.value ?? rawLimits?.maxCustomRoles ?? 0,
    );
    const customDomainsMax = Number(entitlementsResult['custom_domains.max']?.value ?? 0);

    const urlAccess = {
      path: true as const,
      subdomain: plan.key === 'PRO' || plan.key === 'ENTERPRISE',
      customDomain: customDomainsMax > 0 || plan.key === 'ENTERPRISE',
    };

    const limitsWithUrl: PlanLimits = {
      maxMembers,
      maxStorageBytes: maxStorageGb * 1024 * 1024 * 1024,
      maxCustomRoles,
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
      seatCount: subWithPlan?.seatCount ?? 1,
      effectiveModules,
      limits: limitsWithUrl,
      entitlements: entitlementsResult,
      urlAccess,
      urlMode: effectiveUrl?.mode ?? 'path',
      effectiveUrl,
    };
  });
}

export async function assertQuota(
  tenantId: string,
  entitlementKey: string,
  projectedIncrement = 1,
): Promise<void> {
  const effective = await getTenantEntitlements(tenantId);
  const entitlement = effective.entitlements?.[entitlementKey];

  if (!entitlement) {
    if (entitlementKey === 'maxMembers' || entitlementKey === 'members.max') {
      return enforceLimit(tenantId, 'maxMembers', projectedIncrement);
    }
    const def = DEFAULT_ENTITLEMENT_DEFINITIONS.find((d) => d.key === entitlementKey);
    const planKey = effective.planKey || 'FREE';
    const planVal = (DEFAULT_PLAN_ENTITLEMENT_VALUES as any)?.[planKey]?.[entitlementKey] ?? def?.defaultValue;
    if (def?.type === 'BOOLEAN' || typeof planVal === 'boolean') {
      if (!planVal) {
        throw new AppError(
          403,
          `Feature "${entitlementKey}" is not enabled on your workspace plan. Please upgrade to continue.`,
          'FEATURE_NOT_ENTITLED',
          { entitlementKey },
        );
      }
      return;
    }
    return;
  }

  if (entitlement.type === 'BOOLEAN') {
    if (!entitlement.value) {
      throw new AppError(
        403,
        `Feature "${entitlementKey}" is not enabled on your workspace plan. Please upgrade to continue.`,
        'FEATURE_NOT_ENTITLED',
        { entitlementKey },
      );
    }
    return;
  }

  if (entitlement.type === 'INTEGER') {
    const quota = Number(entitlement.value);
    const usage = await billingRepo.getTenantUsage(tenantId);
    let currentUsage = 0;

    if (entitlementKey === 'members.max') {
      currentUsage = usage.members;
    } else if (entitlementKey === 'storage.gb') {
      currentUsage = Math.ceil(usage.storageBytes / (1024 * 1024 * 1024));
    } else if (entitlementKey === 'custom_roles.max') {
      currentUsage = usage.customRoles;
    } else {
      currentUsage = usage.metrics?.[entitlementKey] ?? 0;
    }

    if (currentUsage + projectedIncrement > quota) {
      throw new AppError(
        403,
        `Workspace quota exceeded for ${entitlementKey} (${currentUsage}/${quota}). Please upgrade to continue.`,
        'PLAN_LIMIT_REACHED',
        { limit: quota, current: currentUsage, projectedIncrement, entitlementKey },
      );
    }
  }
}

export async function enforceLimit(
  tenantId: string,
  limitKey: 'maxMembers' | 'maxCustomRoles' | 'maxStorageBytes',
  projectedIncrement = 1,
): Promise<void> {
  const mapKey: Record<string, string> = {
    maxMembers: 'members.max',
    maxCustomRoles: 'custom_roles.max',
    maxStorageBytes: 'storage.gb',
  };
  const key = mapKey[limitKey] ?? limitKey;
  return assertQuota(tenantId, key, projectedIncrement);
}

// ==========================================
// 2. Plans Catalog (Platform Staff & Public)
// ==========================================

export async function listPublicPlans() {
  return cache.wrap(CACHE_KEYS.PUBLIC_PLANS, 300, async () => {
    const plans = await billingRepo.findAllPlans({ status: 'active' });
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

  const { moduleKeys, entitlements, ...planFields } = dto;
  const created = await billingRepo.createPlan(
    {
      ...planFields,
      limits: dto.limits,
    },
    moduleKeys,
    entitlements,
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

  const { moduleKeys, entitlements, ...planFields } = dto;
  const updated = await billingRepo.updatePlan(
    id,
    planFields,
    moduleKeys,
    entitlements,
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
// 3. Entitlement Definitions & Overrides
// ==========================================

export async function listEntitlementDefinitions() {
  return billingRepo.findEntitlementDefinitions();
}

export async function setTenantOverride(
  actorStaffId: string,
  tenantId: string,
  dto: SetTenantEntitlementOverrideDto,
  requestId?: string,
) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const override = await billingRepo.setTenantEntitlementOverride({
    tenantId,
    entitlementKey: dto.entitlementKey,
    value: dto.value,
    expiresAt: dto.expiresAt,
    reason: dto.reason,
    createdBy: actorStaffId,
  });

  await invalidateTenantBillingCache(tenantId);

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.entitlement_override_set',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    metadata: { key: dto.entitlementKey, value: dto.value, expiresAt: dto.expiresAt },
    requestId,
  });

  return override;
}

export async function removeTenantOverride(
  actorStaffId: string,
  tenantId: string,
  entitlementKey: string,
  requestId?: string,
) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const removed = await billingRepo.removeTenantEntitlementOverride(tenantId, entitlementKey);
  await invalidateTenantBillingCache(tenantId);

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.entitlement_override_removed',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    metadata: { key: entitlementKey },
    requestId,
  });

  return { success: removed };
}

// ==========================================
// 4. Subscription Management (Platform & Tenant)
// ==========================================

export async function listPlatformSubscriptions(query?: ListPlatformSubscriptionsQueryDto) {
  return billingRepo.listSubscriptionsForPlatform(query);
}

export async function getPlatformTenantSubscription(tenantId: string) {
  const sub = await billingRepo.findTenantSubscriptionWithPlan(tenantId);
  const entitlements = await getTenantEntitlements(tenantId);
  const usage = await billingRepo.getTenantUsage(tenantId);
  const events = await billingRepo.findSubscriptionEvents(tenantId);
  const overrides = await billingRepo.findTenantEntitlementOverrides(tenantId);

  return {
    subscription: sub,
    entitlements,
    usage,
    events,
    overrides,
  };
}

export async function assignSubscription(
  actorStaffId: string,
  dto: AssignSubscriptionDto,
  requestId?: string,
) {
  const targetPlan = await billingRepo.findPlanByKey(dto.planKey);
  if (!targetPlan) throw AppError.notFound(`Target plan "${dto.planKey}" not found`);

  let sub = await billingRepo.findTenantSubscription(dto.tenantId);
  const fromPlanId = sub?.planId;

  const currentPeriodStart = dto.startDate ?? new Date();
  const trialEndsAt = dto.isTrial
    ? (dto.trialEndsAt ?? new Date(Date.now() + 14 * 86400000))
    : null;
  const status = dto.isTrial ? 'TRIALING' : 'ACTIVE';

  if (!sub) {
    sub = await billingRepo.createSubscription({
      tenantId: dto.tenantId,
      planId: targetPlan.id,
      status,
      currentPeriodStart,
      trialEndsAt,
      billingInterval: dto.billingInterval ?? 'MONTHLY',
      billingEmail: dto.billingEmail,
      seatCount: dto.seatCount ?? 1,
      internalNotes: dto.internalNotes,
      provider: 'manual',
    });
  } else {
    sub = await billingRepo.updateSubscription(sub.id, {
      planId: targetPlan.id,
      status,
      currentPeriodStart,
      trialEndsAt,
      billingInterval: dto.billingInterval ?? sub.billingInterval,
      billingEmail: dto.billingEmail !== undefined ? dto.billingEmail : sub.billingEmail,
      seatCount: dto.seatCount ?? sub.seatCount,
      internalNotes: dto.internalNotes !== undefined ? dto.internalNotes : sub.internalNotes,
    });
  }

  await db
    .update(tenants)
    .set({ plan: targetPlan.key, updatedAt: new Date() })
    .where(eq(tenants.id, dto.tenantId));

  await billingRepo.createSubscriptionEvent({
    subscriptionId: sub!.id,
    tenantId: dto.tenantId,
    type: 'ASSIGNED',
    fromPlanId,
    toPlanId: targetPlan.id,
    actorType: 'PLATFORM_STAFF',
    actorId: actorStaffId,
    metadata: { dto },
  });

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.subscription_assigned',
    targetType: 'tenant',
    targetId: dto.tenantId,
    tenantId: dto.tenantId,
    metadata: { planKey: targetPlan.key, dto },
    requestId,
  });

  const oldPlan = fromPlanId ? await billingRepo.findPlanById(fromPlanId) : null;
  if (oldPlan && oldPlan.key !== targetPlan.key) {
    await onPlanChanged(dto.tenantId, oldPlan.key, targetPlan.key);
  } else {
    await invalidateTenantBillingCache(dto.tenantId);
  }

  return billingRepo.findTenantSubscriptionWithPlan(dto.tenantId);
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
      status: (dto.status as any) ?? 'ACTIVE',
      currentPeriodStart: dto.currentPeriodStart ?? new Date(),
      currentPeriodEnd: dto.currentPeriodEnd,
      trialEndsAt: dto.trialEndsAt,
      cancelAtPeriodEnd: dto.cancelAtPeriodEnd ?? false,
      billingEmail: dto.billingEmail,
      billingInterval: dto.billingInterval ?? 'MONTHLY',
      seatCount: dto.seatCount ?? 1,
      internalNotes: dto.internalNotes,
      provider: 'manual',
    });
  } else {
    sub = await billingRepo.updateSubscription(sub.id, {
      ...(targetPlanId ? { planId: targetPlanId } : {}),
      ...(dto.status ? { status: dto.status as any } : {}),
      ...(dto.currentPeriodStart ? { currentPeriodStart: dto.currentPeriodStart } : {}),
      ...(dto.currentPeriodEnd !== undefined ? { currentPeriodEnd: dto.currentPeriodEnd } : {}),
      ...(dto.trialEndsAt !== undefined ? { trialEndsAt: dto.trialEndsAt } : {}),
      ...(dto.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: dto.cancelAtPeriodEnd } : {}),
      ...(dto.billingEmail !== undefined ? { billingEmail: dto.billingEmail } : {}),
      ...(dto.billingInterval ? { billingInterval: dto.billingInterval } : {}),
      ...(dto.seatCount ? { seatCount: dto.seatCount } : {}),
      ...(dto.internalNotes !== undefined ? { internalNotes: dto.internalNotes } : {}),
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
    entitlements: entitlements.entitlements,
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
// 5. Webhooks & Idempotent Processing
// ==========================================

export async function processBillingWebhook(dto: BillingWebhookDto) {
  const existing = await billingRepo.findBillingWebhook(dto.provider, dto.eventId);
  if (existing) {
    return {
      status: 'DUPLICATE_IGNORED',
      idempotent: true,
      eventId: dto.eventId,
      processedAt: existing.processedAt,
    };
  }

  const { provider, eventId, eventType, payload } = dto;

  if (
    eventType === 'customer.subscription.updated' ||
    eventType === 'subscription.updated'
  ) {
    const tenantId = (payload as any)?.tenantId || (payload as any)?.metadata?.tenantId;
    const planKey = (payload as any)?.planKey || (payload as any)?.plan?.key;
    const status = (payload as any)?.status?.toUpperCase();

    if (tenantId && planKey) {
      const sub = await billingRepo.findTenantSubscription(tenantId);
      const plan = await billingRepo.findPlanByKey(planKey);
      if (sub && plan) {
        await billingRepo.updateSubscription(sub.id, {
          planId: plan.id,
          status: status || sub.status,
          currentPeriodEnd: (payload as any)?.currentPeriodEnd
            ? new Date((payload as any).currentPeriodEnd)
            : sub.currentPeriodEnd,
        });
        await onPlanChanged(tenantId, sub.planId, plan.key);
      }
    }
  } else if (
    eventType === 'customer.subscription.deleted' ||
    eventType === 'subscription.canceled'
  ) {
    const tenantId = (payload as any)?.tenantId || (payload as any)?.metadata?.tenantId;
    if (tenantId) {
      const sub = await billingRepo.findTenantSubscription(tenantId);
      if (sub) {
        // CANCELLATION MUST NOT DELETE TENANT DATA! Only update status to CANCELED
        await billingRepo.updateSubscription(sub.id, {
          status: 'CANCELED',
        });
        await invalidateTenantBillingCache(tenantId);
      }
    }
  }

  const webhookRecord = await billingRepo.createBillingWebhook({
    provider,
    eventId,
    eventType,
    payload,
    status: 'PROCESSED',
  });

  return {
    status: 'PROCESSED',
    idempotent: false,
    record: webhookRecord,
  };
}

// ==========================================
// 6. Invoices Management
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
    metadata: {
      invoiceNumber: created.invoiceNumber,
      amountCents: created.amountCents,
      currency: created.currency,
    },
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
