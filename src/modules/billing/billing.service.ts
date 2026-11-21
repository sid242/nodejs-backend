import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import {
  invoices,
  payments,
  subscriptionEvents,
  subscriptions,
  tenants,
  type Payment,
  type PlanLimits,
  type Subscription,
} from '@/db/schema';
import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import { createDownloadUrl } from '@/lib/s3';
import * as platformRepo from '@/modules/platform/platform.repository';
import * as rbacRepo from '@/modules/rbac/rbac.repository';
import { tenantBrandingRepo } from '@/modules/tenants/tenant-branding.repository';
import {
  getEffectiveUrlMode,
  type EffectiveUrlModeResult,
  type TenantUrlMode,
} from '@/modules/tenants/tenant-url.service';
import { tenantsRepo } from '@/modules/tenants/tenants.repository';
import { emailQueue } from '@/queues/index';
import { emitToUser } from '@/sockets/emitter';

import type {
  AssignSubscriptionDto,
  BillingWebhookDto,
  CancelSubscriptionDto,
  CheckoutOrderDto,
  CheckoutSubscriptionDto,
  CreateInvoiceDto,
  CreatePlanDto,
  IssueRefundDto,
  ListInvoicesQueryDto,
  ListPaymentsQueryDto,
  ListPlansQueryDto,
  ListPlatformInvoicesQueryDto,
  ListPlatformPaymentsQueryDto,
  ListPlatformSubscriptionsQueryDto,
  OverrideEntitlementsDto,
  SetTenantEntitlementOverrideDto,
  SubscriptionChangeRequestDto,
  UpdatePlanDto,
  UpdateSubscriptionDto,
  VerifyOrderPaymentDto,
  VerifySubscriptionPaymentDto,
} from './billing.dto';
import { billingRepo } from './billing.repository';
import {
  DEFAULT_ENTITLEMENT_DEFINITIONS,
  DEFAULT_PLAN_ENTITLEMENT_VALUES,
} from './entitlements.defaults';
import { DEFAULT_PLAN_KEY, DEFAULT_PLANS } from './plans.defaults';
import { razorpayGateway } from './providers/razorpay';
import { calculateGstBreakdown } from './billing.tax';

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
  oldPlanKey: string | null,
  newPlanKey: string,
): Promise<void> {
  // Sync Tenant.plan denormalized column via repository
  await tenantsRepo.updateTenant(tenantId, { plan: newPlanKey });

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
          value: DEFAULT_PLAN_ENTITLEMENT_VALUES?.[plan.key]?.[def.key] as
            string | number | boolean,
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
    const planVal =
      (DEFAULT_PLAN_ENTITLEMENT_VALUES as any)?.[planKey]?.[entitlementKey] ?? def?.defaultValue;
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
  const updated = await billingRepo.updatePlan(id, planFields, moduleKeys, entitlements);

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
    message:
      'Subscription change request submitted successfully. Our operations team has been notified.',
    event,
  };
}

// ==========================================
// 5. Webhooks & Idempotent Processing
// ==========================================

export async function processBillingWebhook(dto: BillingWebhookDto) {
  const { provider, eventId, eventType, payload } = dto;

  // 1. Atomic insert first with status 'RECEIVED' to lock eventId
  const inserted = billingRepo.recordWebhookReceived
    ? await billingRepo.recordWebhookReceived({
        provider,
        eventId,
        eventType,
        payload,
      })
    : await billingRepo.createBillingWebhook({
        provider,
        eventId,
        eventType,
        payload,
        status: 'RECEIVED',
      });

  let webhookRecordId = '';
  let activeRecord = inserted;
  if (!inserted) {
    const existing = await billingRepo.findBillingWebhook(provider, eventId);
    if (existing && (existing.status === 'PROCESSED' || existing.status === 'RECEIVED')) {
      return {
        status: 'DUPLICATE_IGNORED',
        idempotent: true,
        eventId,
        processedAt: existing.processedAt,
        record: existing,
      };
    }
    webhookRecordId = existing ? existing.id : '';
    activeRecord = existing;
  } else {
    webhookRecordId = inserted.id;
  }

  try {
    // Only handle authenticated razorpay provider events
    if (provider === 'razorpay') {
      const pEntity = (payload as any)?.payload?.payment?.entity;
      const oEntity = (payload as any)?.payload?.order?.entity;
      const sEntity = (payload as any)?.payload?.subscription?.entity;
      const rEntity = (payload as any)?.payload?.refund?.entity;

      // Handle payment.captured / order.paid
      if (eventType === 'payment.captured' || eventType === 'order.paid') {
        const orderId = pEntity?.order_id ?? oEntity?.id;
        const paymentId = pEntity?.id;

        // Resolve payment and tenant from DB, not from untrusted payload notes alone
        const localPayment = orderId
          ? await billingRepo.findPaymentByOrderId(orderId)
          : paymentId
            ? await billingRepo.findPaymentByPaymentId(paymentId)
            : null;

        if (localPayment) {
          // If notes are present, verify tenant matches
          const notesTenantId = pEntity?.notes?.tenantId ?? oEntity?.notes?.tenantId;
          if (notesTenantId && notesTenantId !== localPayment.tenantId) {
            logger.warn(
              { notesTenantId, localTenantId: localPayment.tenantId, orderId },
              'Razorpay webhook tenant mismatch on payment',
            );
            throw AppError.badRequest('Webhook tenant identity mismatch');
          }

          // Validate amount and currency against expected local payment record
          const eventAmount = Number(pEntity?.amount ?? oEntity?.amount ?? 0);
          const eventCurrency = (pEntity?.currency ?? oEntity?.currency ?? '').toUpperCase();
          if (
            (eventAmount > 0 && eventAmount !== localPayment.amountMinor) ||
            (eventCurrency && eventCurrency !== localPayment.currency.toUpperCase())
          ) {
            logger.warn(
              {
                localPaymentId: localPayment.id,
                expectedAmount: localPayment.amountMinor,
                expectedCurrency: localPayment.currency,
                eventAmount,
                eventCurrency,
              },
              'Payment amount or currency mismatch on webhook',
            );
            await billingRepo.updatePayment(localPayment.id, {
              status: 'FAILED',
              failureCode: 'AMOUNT_MISMATCH',
              failureDescription: `Amount or currency mismatch: received ${eventAmount} ${eventCurrency}, expected ${localPayment.amountMinor} ${localPayment.currency}`,
            });
          } else {
            // Share unified activation function
            await activatePaidOrder({
              paymentId: localPayment.id,
              providerPaymentId: paymentId,
              paymentMethod: pEntity?.method,
            });
          }
        }
      } else if (eventType === 'payment.authorized') {
        const orderId = pEntity?.order_id ?? oEntity?.id;
        const paymentId = pEntity?.id;
        const localPayment = orderId
          ? await billingRepo.findPaymentByOrderId(orderId)
          : paymentId
            ? await billingRepo.findPaymentByPaymentId(paymentId)
            : null;

        if (localPayment && localPayment.status === 'CREATED') {
          await billingRepo.updatePayment(localPayment.id, {
            status: 'AUTHORIZED',
            providerPaymentId: paymentId ?? localPayment.providerPaymentId,
            paymentMethod: pEntity?.method ?? localPayment.paymentMethod,
          });
        }
      } else if (eventType === 'payment.failed') {
        const orderId = pEntity?.order_id ?? oEntity?.id;
        const paymentId = pEntity?.id;
        const localPayment = orderId
          ? await billingRepo.findPaymentByOrderId(orderId)
          : paymentId
            ? await billingRepo.findPaymentByPaymentId(paymentId)
            : null;

        if (localPayment) {
          await billingRepo.updatePayment(localPayment.id, {
            status: 'FAILED',
            failureCode: pEntity?.error_code ?? 'PAYMENT_FAILED',
            failureDescription: pEntity?.error_description ?? 'Payment attempt failed',
          });
        }
      } else if (
        eventType === 'subscription.authenticated' ||
        eventType === 'subscription.activated' ||
        eventType === 'subscription.charged'
      ) {
        const rzpSubId = sEntity?.id;
        const notes = sEntity?.notes ?? {};
        const planKey = notes.planKey;

        // Resolve subscription from DB first by providerSubscriptionId
        const existingSub = rzpSubId
          ? await billingRepo.findSubscriptionByProviderId(rzpSubId)
          : null;
        const tenantId = existingSub?.tenantId ?? notes.tenantId;

        if (existingSub && notes.tenantId && existingSub.tenantId !== notes.tenantId) {
          logger.warn(
            { notesTenantId: notes.tenantId, existingTenantId: existingSub.tenantId, rzpSubId },
            'Razorpay webhook tenant mismatch on subscription',
          );
          throw AppError.badRequest('Webhook tenant identity mismatch on subscription');
        }

        if (rzpSubId && tenantId) {
          const sub = existingSub ?? (await billingRepo.findTenantSubscription(tenantId));
          const plan = planKey ? await billingRepo.findPlanByKey(planKey) : null;

          const currentPeriodStart = sEntity?.current_start
            ? new Date(sEntity.current_start * 1000)
            : new Date();
          const currentPeriodEnd = sEntity?.current_end
            ? new Date(sEntity.current_end * 1000)
            : new Date(Date.now() + 30 * 86400000);

          const fromPlanId = sub?.planId;

          if (sub) {
            await billingRepo.updateSubscription(sub.id, {
              status: 'ACTIVE',
              provider: 'razorpay',
              providerSubscriptionId: rzpSubId,
              currentPeriodStart,
              currentPeriodEnd,
              planId: plan?.id ?? sub.planId,
            });
          } else if (plan) {
            await billingRepo.createSubscription({
              tenantId,
              planId: plan.id,
              status: 'ACTIVE',
              provider: 'razorpay',
              providerSubscriptionId: rzpSubId,
              currentPeriodStart,
              currentPeriodEnd,
            });
          }

          if (plan) {
            const oldPlan = fromPlanId ? await billingRepo.findPlanById(fromPlanId) : null;
            const oldPlanKey = oldPlan?.key ?? null;
            if (oldPlanKey !== plan.key) {
              await onPlanChanged(tenantId, oldPlanKey, plan.key);
            } else {
              await invalidateTenantBillingCache(tenantId);
            }
          } else {
            await invalidateTenantBillingCache(tenantId);
          }
        }
      } else if (eventType === 'subscription.halted' || eventType === 'subscription.pending') {
        const rzpSubId = sEntity?.id;
        const notes = sEntity?.notes ?? {};
        const sub = rzpSubId ? await billingRepo.findSubscriptionByProviderId(rzpSubId) : null;
        const tenantId = sub?.tenantId ?? notes.tenantId;

        if (tenantId) {
          logger.warn(
            { tenantId, rzpSubId, eventType },
            'Subscription halted or pending payment; dunning alert recorded',
          );
          const activeSub = sub ?? (await billingRepo.findTenantSubscription(tenantId));
          if (activeSub) {
            await billingRepo.updateSubscription(activeSub.id, {
              status: 'PAST_DUE',
            });
            await invalidateTenantBillingCache(tenantId);
          }
        }
      } else if (eventType === 'subscription.cancelled' || eventType === 'subscription.completed') {
        const rzpSubId = sEntity?.id;
        const notes = sEntity?.notes ?? {};
        const sub = rzpSubId ? await billingRepo.findSubscriptionByProviderId(rzpSubId) : null;
        const tenantId = sub?.tenantId ?? notes.tenantId;

        if (tenantId) {
          const activeSub = sub ?? (await billingRepo.findTenantSubscription(tenantId));
          if (activeSub) {
            await billingRepo.updateSubscription(activeSub.id, {
              status: 'CANCELED',
            });
            await invalidateTenantBillingCache(tenantId);
          }
        }
      } else if (eventType === 'refund.created') {
        const refundId = rEntity?.id;
        const paymentId = rEntity?.payment_id;
        if (refundId) {
          const localRefund = await billingRepo.findRefundByProviderRefundId(refundId);
          if (!localRefund && paymentId) {
            const payment = await billingRepo.findPaymentByPaymentId(paymentId);
            if (payment) {
              await billingRepo.createRefund({
                tenantId: payment.tenantId,
                paymentId: payment.id,
                provider: 'razorpay',
                providerRefundId: refundId,
                amountMinor: Number(rEntity?.amount ?? 0),
                currency: rEntity?.currency ?? payment.currency,
                status: 'INITIATED',
                requestedBy: 'razorpay_webhook',
              });
            }
          }
        }
      } else if (eventType === 'refund.processed') {
        const refundId = rEntity?.id;
        if (refundId) {
          const localRefund = await billingRepo.findRefundByProviderRefundId(refundId);
          if (localRefund) {
            await billingRepo.updateRefund(localRefund.id, {
              status: 'PROCESSED',
              processedAt: new Date(),
            });
          }
        }
      } else if (eventType === 'refund.failed') {
        const refundId = rEntity?.id;
        if (refundId) {
          const localRefund = await billingRepo.findRefundByProviderRefundId(refundId);
          if (localRefund) {
            await billingRepo.updateRefund(localRefund.id, {
              status: 'FAILED',
            });
            // Recalculate parent payment status based on remaining valid refunds
            const allRefunds = await billingRepo.findRefundsByPaymentId(localRefund.paymentId);
            const validRefundedSum = allRefunds
              .filter(
                (r) => r.id !== localRefund.id && ['INITIATED', 'PROCESSED'].includes(r.status),
              )
              .reduce((sum, r) => sum + r.amountMinor, 0);

            const payment = await billingRepo.findPaymentById(localRefund.paymentId);
            if (payment) {
              let newStatus: 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' = 'PAID';
              if (validRefundedSum >= payment.amountMinor) {
                newStatus = 'REFUNDED';
              } else if (validRefundedSum > 0) {
                newStatus = 'PARTIALLY_REFUNDED';
              }
              await billingRepo.updatePayment(payment.id, {
                status: newStatus,
              });
            }
          }
        }
      }
    }

    if (webhookRecordId && billingRepo.updateBillingWebhookStatus) {
      await billingRepo.updateBillingWebhookStatus(webhookRecordId, 'PROCESSED', null);
    }

    return {
      status: 'PROCESSED',
      idempotent: false,
      eventId,
      eventType,
      record: activeRecord ?? { id: webhookRecordId, eventId, provider, eventType },
    };
  } catch (err: any) {
    if (webhookRecordId) {
      await billingRepo.updateBillingWebhookStatus(
        webhookRecordId,
        'FAILED',
        err?.message || 'Webhook processing failed',
      );
    }
    logger.error({ err, eventId, eventType }, 'Billing webhook processing failed');
    throw AppError.internal('Webhook processing failed, retrying');
  }
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

export async function downloadTenantInvoice(tenantId: string, invoiceId: string) {
  const invoice = await getTenantInvoiceById(tenantId, invoiceId);

  let downloadUrl = invoice.pdfUrl;
  if (invoice.pdfUrl && !invoice.pdfUrl.startsWith('http')) {
    downloadUrl = await createDownloadUrl(invoice.pdfUrl, 300, {
      filename: `invoice-${invoice.invoiceNumber}.pdf`,
      disposition: 'attachment',
    });
  }

  return {
    invoiceNumber: invoice.invoiceNumber,
    downloadUrl: downloadUrl ?? null,
    invoice,
  };
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

// ==========================================
// 7. Razorpay Checkout, Payments & Refunds
// ==========================================

export interface ActivatePaidOrderParams {
  paymentId?: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  providerSignature?: string;
  paymentMethod?: string;
  actorUserId?: string;
}

export interface ActivatePaidOrderResult {
  success: boolean;
  status: string;
  alreadyProcessed: boolean;
  planKey: string;
  planName: string;
  subscriptionId: string;
  paymentId: string;
  tenantId: string;
}

/**
 * Shared atomic activation function for Razorpay orders (used by both verify endpoint and webhooks).
 * Acquires a SELECT ... FOR UPDATE lock on the payment row to guarantee atomic, once-and-only-once execution.
 */
export async function activatePaidOrder(
  params: ActivatePaidOrderParams,
): Promise<ActivatePaidOrderResult> {
  let postActivationAction: {
    tenantId: string;
    oldPlanKey: string | null;
    newPlanKey: string;
    actorUserId?: string;
    orderId?: string | null;
    paymentId?: string;
    planName: string;
  } | null = null;

  const result = await db.transaction(async (tx) => {
    let payment: Payment | null = null;
    if (params.paymentId) {
      const [row] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, params.paymentId))
        .for('update');
      payment = row ?? null;
    } else if (params.providerOrderId) {
      const [row] = await tx
        .select()
        .from(payments)
        .where(eq(payments.providerOrderId, params.providerOrderId))
        .for('update');
      payment = row ?? null;
    }

    if (!payment) {
      throw AppError.notFound('Payment record not found');
    }

    const meta = (payment.metadata ?? {}) as Record<string, any>;
    const targetPlanKey = (meta.planKey ?? 'PRO').toUpperCase();
    const plan =
      (await billingRepo.findPlanByKey(targetPlanKey, tx)) ??
      (meta.planId ? await billingRepo.findPlanById(meta.planId, tx) : null);

    if (!plan) {
      throw AppError.notFound(`Plan "${targetPlanKey}" not found`);
    }

    // Idempotency check: if already PAID, return idempotent success
    if (payment.status === 'PAID') {
      const existingSub = await tx
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.tenantId, payment.tenantId),
            sql`${subscriptions.status} IN ('TRIALING', 'ACTIVE', 'PAST_DUE')`,
          ),
        )
        .limit(1);

      return {
        success: true,
        status: 'PAID',
        alreadyProcessed: true,
        planKey: plan.key,
        planName: plan.name,
        subscriptionId: payment.subscriptionId ?? existingSub[0]?.id ?? '',
        paymentId: payment.id,
        tenantId: payment.tenantId,
      };
    }

    const paidAt = new Date();
    const [updatedPayment] = await tx
      .update(payments)
      .set({
        status: 'PAID',
        providerPaymentId: params.providerPaymentId ?? payment.providerPaymentId,
        providerSignature: params.providerSignature ?? payment.providerSignature,
        paymentMethod: params.paymentMethod ?? payment.paymentMethod,
        paidAt,
        updatedAt: paidAt,
      })
      .where(eq(payments.id, payment.id))
      .returning();

    if (!updatedPayment) {
      throw AppError.internal('Failed to update payment status');
    }

    // Period calculation: extend from current period end if still active
    const isAnnual = meta.billingInterval === 'ANNUAL';
    const now = new Date();

    const [existingSub] = await tx
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.tenantId, payment.tenantId),
          sql`${subscriptions.status} IN ('TRIALING', 'ACTIVE', 'PAST_DUE')`,
        ),
      )
      .limit(1);

    const baseStart =
      existingSub?.status === 'ACTIVE' &&
      existingSub?.currentPeriodEnd &&
      new Date(existingSub.currentPeriodEnd) > now
        ? new Date(existingSub.currentPeriodEnd)
        : now;

    const currentPeriodStart = baseStart === now ? now : (existingSub?.currentPeriodStart ?? now);
    const currentPeriodEnd = new Date(baseStart.getTime());
    if (isAnnual) {
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    } else {
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    }

    const fromPlanId = existingSub?.planId ?? null;
    let subRecord: Subscription;

    if (existingSub) {
      const [updated] = await tx
        .update(subscriptions)
        .set({
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart,
          currentPeriodEnd,
          billingInterval: isAnnual ? 'ANNUAL' : 'MONTHLY',
          cancelAtPeriodEnd: false,
          provider: 'razorpay',
          updatedAt: now,
        })
        .where(eq(subscriptions.id, existingSub.id))
        .returning();
      if (!updated) {
        throw AppError.internal('Failed to update subscription record');
      }
      subRecord = updated;
    } else {
      const [created] = await tx
        .insert(subscriptions)
        .values({
          tenantId: payment.tenantId,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart,
          currentPeriodEnd,
          billingInterval: isAnnual ? 'ANNUAL' : 'MONTHLY',
          provider: 'razorpay',
        })
        .returning();
      if (!created) {
        throw AppError.internal('Failed to create subscription record');
      }
      subRecord = created;
    }

    if (!updatedPayment.subscriptionId) {
      await tx
        .update(payments)
        .set({ subscriptionId: subRecord.id })
        .where(eq(payments.id, updatedPayment.id));
    }

    // Auto-generate invoice with GST breakdown
    const gst = calculateGstBreakdown(payment.amountMinor, payment.currency, false);
    const tenant = await tenantsRepo.findTenantById(payment.tenantId);
    const generatedInv = await billingRepo.generateInvoiceNumber(now.getFullYear(), tx);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        tenantId: payment.tenantId,
        subscriptionId: subRecord.id,
        planId: plan.id,
        invoiceNumber: generatedInv.invoiceNumber,
        invoiceYear: generatedInv.year,
        invoiceSeq: generatedInv.seq,
        amountCents: gst.subtotalMinor,
        taxCents: gst.taxMinor,
        totalCents: payment.amountMinor,
        subtotalMinor: gst.subtotalMinor,
        taxBreakdown: gst.taxBreakdown,
        customerSnapshot: {
          name: tenant?.name ?? 'Workspace',
          email: tenant?.slug ? `${tenant.slug}@example.com` : '',
        },
        currency: payment.currency,
        status: 'PAID',
        paidAt: now,
        billingPeriodStart: currentPeriodStart,
        billingPeriodEnd: currentPeriodEnd,
        lineItems: [
          {
            description: `${plan.name} Plan (${isAnnual ? 'Annual' : 'Monthly'})`,
            quantity: 1,
            unitPriceCents: gst.subtotalMinor,
            totalCents: gst.subtotalMinor,
          },
        ],
      })
      .returning();

    if (!invoice) {
      throw AppError.internal('Failed to generate invoice record');
    }

    // Log subscription event
    await tx.insert(subscriptionEvents).values({
      subscriptionId: subRecord.id,
      tenantId: payment.tenantId,
      type: 'PURCHASED',
      fromPlanId,
      toPlanId: plan.id,
      actorType: params.actorUserId ? 'USER' : 'SYSTEM',
      actorId: params.actorUserId ?? 'system',
      metadata: {
        orderId: payment.providerOrderId,
        paymentId: updatedPayment.providerPaymentId,
        planKey: plan.key,
        billingInterval: isAnnual ? 'ANNUAL' : 'MONTHLY',
        invoiceId: invoice.id,
      },
    });

    const oldPlan = fromPlanId ? await billingRepo.findPlanById(fromPlanId, tx) : null;

    postActivationAction = {
      tenantId: payment.tenantId,
      oldPlanKey: oldPlan?.key ?? null,
      newPlanKey: plan.key,
      actorUserId: params.actorUserId,
      orderId: payment.providerOrderId,
      paymentId: updatedPayment.providerPaymentId ?? undefined,
      planName: plan.name,
    };

    return {
      success: true,
      status: 'PAID',
      alreadyProcessed: false,
      planKey: plan.key,
      planName: plan.name,
      subscriptionId: subRecord.id,
      paymentId: updatedPayment.id,
      tenantId: payment.tenantId,
    };
  });

  // Post-transaction notifications and cache sync
  if (postActivationAction) {
    const { tenantId, oldPlanKey, newPlanKey, actorUserId, orderId, paymentId, planName } =
      postActivationAction;
    if (oldPlanKey !== newPlanKey) {
      await onPlanChanged(tenantId, oldPlanKey, newPlanKey);
    } else {
      await invalidateTenantBillingCache(tenantId);
    }

    if (actorUserId) {
      emitToUser(actorUserId, 'billing:payment_success', {
        orderId,
        paymentId,
        planKey: newPlanKey,
        planName,
      });
    }
  }

  return result;
}

export async function createTenantOrderCheckout(tenantId: string, dto: CheckoutOrderDto) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const plan = await billingRepo.findPlanByKey(dto.planKey);
  if (!plan) throw AppError.notFound(`Plan "${dto.planKey}" not found`);
  if (!plan.isActive)
    throw AppError.badRequest(`Plan "${dto.planKey}" is not available for purchase`);

  const isAnnual = dto.billingInterval === 'ANNUAL';
  const amountMinor = isAnnual ? plan.priceYearlyMinor : plan.priceMonthlyMinor;

  if (amountMinor <= 0) {
    throw AppError.badRequest('Free plans do not require a checkout payment');
  }

  const keyId = env.RAZORPAY_KEY_ID;
  if (!keyId) {
    throw AppError.internal('Razorpay key ID is not configured on the server');
  }

  // Idempotency: reuse existing CREATED payment for same tenant + plan + interval in the last 15 min
  const existingPayment = await billingRepo.findRecentCreatedPayment(
    tenantId,
    plan.key,
    dto.billingInterval,
    15 * 60 * 1000,
  );
  if (existingPayment && existingPayment.providerOrderId) {
    return {
      keyId,
      orderId: existingPayment.providerOrderId,
      amountMinor: existingPayment.amountMinor,
      currency: existingPayment.currency,
      planName: plan.name,
      paymentRecordId: existingPayment.id,
    };
  }

  // 1. Create a local pending payment record before calling provider
  const localPayment = await billingRepo.createPayment({
    tenantId,
    provider: 'razorpay',
    amountMinor,
    currency: plan.currency || env.RAZORPAY_CURRENCY || 'INR',
    status: 'CREATED',
    metadata: {
      planKey: plan.key,
      planId: plan.id,
      billingInterval: dto.billingInterval,
    },
  });

  // 2. Call Razorpay Orders API with deterministic receipt
  const receipt = `rcpt_${tenantId.slice(0, 8)}_${localPayment.id.slice(0, 8)}`;
  const order = await razorpayGateway.createRazorpayOrder({
    amountMinor,
    currency: plan.currency || env.RAZORPAY_CURRENCY || 'INR',
    receipt,
    notes: {
      tenantId,
      planKey: plan.key,
      billingInterval: dto.billingInterval,
      paymentRecordId: localPayment.id,
    },
  });

  // 3. Link provider order ID
  await billingRepo.updatePayment(localPayment.id, {
    providerOrderId: order.id,
  });

  return {
    keyId,
    orderId: order.id,
    amountMinor: order.amount,
    currency: order.currency,
    planName: plan.name,
    paymentRecordId: localPayment.id,
  };
}

export async function verifyTenantOrderPayment(
  tenantId: string,
  actorUserId: string,
  dto: VerifyOrderPaymentDto,
) {
  // 1. Find local pending payment record
  const localPayment = await billingRepo.findPaymentByOrderId(dto.razorpay_order_id);
  if (!localPayment || localPayment.tenantId !== tenantId) {
    throw AppError.notFound('Payment order not found for this workspace');
  }

  // 2. If already marked paid, return success idempotently
  if (localPayment.status === 'PAID') {
    return {
      success: true,
      status: 'PAID',
      message: 'Payment has already been verified and processed',
      paymentId: localPayment.id,
    };
  }

  // 3. Server-side signature verification
  const isValid = razorpayGateway.verifyOrderPaymentSignature({
    orderId: dto.razorpay_order_id,
    paymentId: dto.razorpay_payment_id,
    signature: dto.razorpay_signature,
  });

  if (!isValid) {
    throw AppError.badRequest('Invalid payment signature from payment gateway');
  }

  // 4. Fetch payment details from Razorpay to confirm capture
  const rzpPayment = await razorpayGateway.fetchRazorpayPayment(dto.razorpay_payment_id);
  if (rzpPayment.status !== 'captured' && rzpPayment.status !== 'authorized') {
    throw AppError.badRequest(`Payment status is not captured (current: ${rzpPayment.status})`);
  }

  // 5. Validate amount and currency
  const rzpAmount = Number(rzpPayment.amount ?? 0);
  const rzpCurrency = (rzpPayment.currency ?? '').toUpperCase();
  if (
    rzpAmount !== localPayment.amountMinor ||
    rzpCurrency !== localPayment.currency.toUpperCase()
  ) {
    await billingRepo.updatePayment(localPayment.id, {
      status: 'FAILED',
      failureCode: 'AMOUNT_MISMATCH',
      failureDescription: 'Payment amount or currency mismatch',
    });
    throw AppError.badRequest('Payment amount or currency does not match order');
  }

  // 6. Unified atomic activation function
  const result = await activatePaidOrder({
    paymentId: localPayment.id,
    providerPaymentId: dto.razorpay_payment_id,
    providerSignature: dto.razorpay_signature,
    paymentMethod: rzpPayment.method,
    actorUserId,
  });

  return {
    success: true,
    status: 'PAID',
    planKey: result.planKey,
    planName: result.planName,
    subscriptionId: result.subscriptionId,
    paymentId: result.paymentId,
  };
}

export async function createTenantSubscriptionCheckout(
  tenantId: string,
  dto: CheckoutSubscriptionDto,
) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const plan = await billingRepo.findPlanByKey(dto.planKey);
  if (!plan) throw AppError.notFound(`Plan "${dto.planKey}" not found`);
  if (!plan.isActive)
    throw AppError.badRequest(`Plan "${dto.planKey}" is not available for purchase`);

  const keyId = env.RAZORPAY_KEY_ID;
  if (!keyId) {
    throw AppError.internal('Razorpay key ID is not configured on the server');
  }

  const isAnnual = dto.billingInterval === 'ANNUAL';
  const amountMinor = isAnnual ? plan.priceYearlyMinor : plan.priceMonthlyMinor;
  if (amountMinor <= 0) {
    throw AppError.badRequest('Free plans do not require a subscription checkout');
  }

  // Lazy plan creation: store razorpayPlanIdMonthly/Yearly on local Plan and reuse
  let rzpPlanId = isAnnual ? plan.razorpayPlanIdYearly : plan.razorpayPlanIdMonthly;
  if (!rzpPlanId) {
    const createdPlan = await razorpayGateway.createRazorpayPlan({
      period: isAnnual ? 'yearly' : 'monthly',
      interval: 1,
      name: `${plan.name} (${isAnnual ? 'Annual' : 'Monthly'})`,
      amountMinor,
      currency: plan.currency || env.RAZORPAY_CURRENCY || 'INR',
      description: plan.description ?? undefined,
    });
    rzpPlanId = createdPlan.id;
    await billingRepo.updatePlan(plan.id, {
      [isAnnual ? 'razorpayPlanIdYearly' : 'razorpayPlanIdMonthly']: rzpPlanId,
    });
  }

  // Create recurring subscription in Razorpay
  const rzpSub = await razorpayGateway.createRazorpaySubscription({
    planId: rzpPlanId,
    totalCount: dto.totalCount,
    notes: {
      tenantId,
      tenantSlug: tenant.slug,
      planKey: plan.key,
      planId: plan.id,
      billingInterval: dto.billingInterval,
    },
  });

  // Persist a local pending subscription/payment mapping (providerSubscriptionId -> tenantId)
  await billingRepo.createPayment({
    tenantId,
    provider: 'razorpay',
    amountMinor,
    currency: plan.currency || env.RAZORPAY_CURRENCY || 'INR',
    status: 'CREATED',
    metadata: {
      providerSubscriptionId: rzpSub.id,
      planKey: plan.key,
      planId: plan.id,
      billingInterval: dto.billingInterval,
    },
  });

  return {
    keyId,
    subscriptionId: rzpSub.id,
    planName: plan.name,
    amountMinor,
    currency: plan.currency,
  };
}

export async function verifyTenantSubscriptionPayment(
  tenantId: string,
  actorUserId: string,
  dto: VerifySubscriptionPaymentDto,
) {
  // 1. Verify recurring subscription payment signature
  const isValid = razorpayGateway.verifySubscriptionPaymentSignature({
    subscriptionId: dto.razorpay_subscription_id,
    paymentId: dto.razorpay_payment_id,
    signature: dto.razorpay_signature,
  });

  if (!isValid) {
    throw AppError.badRequest('Invalid recurring subscription signature');
  }

  // 2. Fetch the subscription from Razorpay; require notes.tenantId === tenantId or local mapping
  const rzpSub = await razorpayGateway.fetchRazorpaySubscription(dto.razorpay_subscription_id);
  const subNotes = (rzpSub.notes ?? {}) as Record<string, string>;

  let isTenantAuthorized = subNotes.tenantId === tenantId;
  if (!isTenantAuthorized) {
    const localSub = await billingRepo.findSubscriptionByProviderId(dto.razorpay_subscription_id);
    if (localSub && localSub.tenantId === tenantId) {
      isTenantAuthorized = true;
    }
  }

  if (!isTenantAuthorized) {
    throw AppError.forbidden('Unauthorized subscription verification for this workspace');
  }

  // 3. Fetch payment; require status captured or authorized
  const rzpPayment = await razorpayGateway.fetchRazorpayPayment(dto.razorpay_payment_id);
  if (rzpPayment.status !== 'captured' && rzpPayment.status !== 'authorized') {
    throw AppError.badRequest(`Payment status is not captured (current: ${rzpPayment.status})`);
  }

  // Resolve plan from subscription notes
  const targetPlanKey = (subNotes.planKey ?? 'PRO').toUpperCase();
  const plan =
    (await billingRepo.findPlanByKey(targetPlanKey)) ??
    (subNotes.planId ? await billingRepo.findPlanById(subNotes.planId) : null);

  if (!plan) {
    throw AppError.notFound(`Plan "${targetPlanKey}" not found for subscription`);
  }

  const billingInterval = subNotes.billingInterval === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY';
  const isAnnual = billingInterval === 'ANNUAL';
  const expectedAmount = isAnnual ? plan.priceYearlyMinor : plan.priceMonthlyMinor;
  const rzpAmount = Number(rzpPayment.amount ?? 0);
  const rzpCurrency = (rzpPayment.currency ?? '').toUpperCase();

  if (
    rzpAmount !== expectedAmount ||
    (rzpCurrency && rzpCurrency !== (plan.currency || 'INR').toUpperCase())
  ) {
    throw AppError.badRequest('Payment amount or currency does not match subscription plan');
  }

  // 4. DB transaction with atomic updates
  const { sub, payment, fromPlanId } = await db.transaction(async (tx) => {
    // Set period from Razorpay subscription current_start/current_end (not a hardcoded 30 days)
    const currentPeriodStart = rzpSub.current_start
      ? new Date(rzpSub.current_start * 1000)
      : new Date();
    const currentPeriodEnd = rzpSub.current_end
      ? new Date(rzpSub.current_end * 1000)
      : isAnnual
        ? new Date(Date.now() + 365 * 86400000)
        : new Date(Date.now() + 30 * 86400000);

    const [existingSub] = await tx
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.tenantId, tenantId),
          sql`${subscriptions.status} IN ('TRIALING', 'ACTIVE', 'PAST_DUE')`,
        ),
      )
      .limit(1);

    const prevPlanId = existingSub?.planId ?? null;
    let activeSub: Subscription;

    if (existingSub) {
      const [updated] = await tx
        .update(subscriptions)
        .set({
          planId: plan.id,
          status: 'ACTIVE',
          provider: 'razorpay',
          providerSubscriptionId: dto.razorpay_subscription_id,
          currentPeriodStart,
          currentPeriodEnd,
          billingInterval,
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, existingSub.id))
        .returning();
      if (!updated) {
        throw AppError.internal('Failed to update subscription record');
      }
      activeSub = updated;
    } else {
      const [created] = await tx
        .insert(subscriptions)
        .values({
          tenantId,
          planId: plan.id,
          status: 'ACTIVE',
          provider: 'razorpay',
          providerSubscriptionId: dto.razorpay_subscription_id,
          currentPeriodStart,
          currentPeriodEnd,
          billingInterval,
        })
        .returning();
      if (!created) {
        throw AppError.internal('Failed to create subscription record');
      }
      activeSub = created;
    }

    // Idempotent payment upsert
    const paidPayment = await billingRepo.upsertPayment(
      {
        tenantId,
        subscriptionId: activeSub.id,
        provider: 'razorpay',
        providerPaymentId: dto.razorpay_payment_id,
        providerSignature: dto.razorpay_signature,
        amountMinor: rzpAmount,
        currency: rzpPayment.currency ?? plan.currency ?? 'INR',
        status: 'PAID',
        paymentMethod: rzpPayment.method,
        paidAt: new Date(),
        metadata: {
          providerSubscriptionId: dto.razorpay_subscription_id,
          planKey: plan.key,
          planId: plan.id,
          billingInterval,
        },
      },
      tx,
    );

    // Auto-generate invoice with GST breakdown
    const gst = calculateGstBreakdown(rzpAmount, paidPayment.currency, false);
    const tenant = await tenantsRepo.findTenantById(tenantId);
    const generatedInv = await billingRepo.generateInvoiceNumber(new Date().getFullYear(), tx);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        tenantId,
        subscriptionId: activeSub.id,
        planId: plan.id,
        invoiceNumber: generatedInv.invoiceNumber,
        invoiceYear: generatedInv.year,
        invoiceSeq: generatedInv.seq,
        amountCents: gst.subtotalMinor,
        taxCents: gst.taxMinor,
        totalCents: rzpAmount,
        subtotalMinor: gst.subtotalMinor,
        taxBreakdown: gst.taxBreakdown,
        customerSnapshot: {
          name: tenant?.name ?? 'Workspace',
          email: activeSub.billingEmail ?? (tenant?.slug ? `${tenant.slug}@example.com` : ''),
        },
        currency: paidPayment.currency,
        status: 'PAID',
        paidAt: new Date(),
        billingPeriodStart: currentPeriodStart,
        billingPeriodEnd: currentPeriodEnd,
        lineItems: [
          {
            description: `${plan.name} Plan (${isAnnual ? 'Annual' : 'Monthly'})`,
            quantity: 1,
            unitPriceCents: gst.subtotalMinor,
            totalCents: gst.subtotalMinor,
          },
        ],
      })
      .returning();

    if (!invoice) {
      throw AppError.internal('Failed to generate invoice record');
    }

    // Log subscription event
    await tx.insert(subscriptionEvents).values({
      subscriptionId: activeSub.id,
      tenantId,
      type: 'PURCHASED',
      fromPlanId: prevPlanId,
      toPlanId: plan.id,
      actorType: 'USER',
      actorId: actorUserId,
      metadata: {
        subscriptionId: dto.razorpay_subscription_id,
        paymentId: dto.razorpay_payment_id,
        planKey: plan.key,
        billingInterval,
        invoiceId: invoice.id,
      },
    });

    return { sub: activeSub, payment: paidPayment, fromPlanId: prevPlanId };
  });

  // Post-transaction notifications and cache sync
  const oldPlan = fromPlanId ? await billingRepo.findPlanById(fromPlanId) : null;
  const oldPlanKey = oldPlan?.key ?? null;
  if (oldPlanKey !== plan.key) {
    await onPlanChanged(tenantId, oldPlanKey, plan.key);
  } else {
    await invalidateTenantBillingCache(tenantId);
  }

  emitToUser(actorUserId, 'billing:subscription_activated', {
    subscriptionId: dto.razorpay_subscription_id,
    paymentId: dto.razorpay_payment_id,
  });

  return {
    success: true,
    status: 'ACTIVE',
    paymentId: payment.id,
    subscriptionId: sub.id,
    planKey: plan.key,
    planName: plan.name,
  };
}

export async function cancelTenantSubscription(
  tenantId: string,
  actorUserId: string,
  dto: CancelSubscriptionDto,
) {
  const sub = await billingRepo.findTenantSubscription(tenantId);
  if (!sub) throw AppError.notFound('No active subscription found for this workspace');

  if (sub.provider === 'razorpay' && sub.providerSubscriptionId) {
    await razorpayGateway.cancelRazorpaySubscription(sub.providerSubscriptionId, !dto.immediately);
  }

  const updated = await billingRepo.updateSubscription(sub.id, {
    status: dto.immediately ? 'CANCELED' : sub.status,
    cancelAtPeriodEnd: !dto.immediately,
  });

  await billingRepo.createSubscriptionEvent({
    subscriptionId: sub.id,
    tenantId,
    type: 'CANCELED',
    fromPlanId: sub.planId,
    actorType: 'USER',
    actorId: actorUserId,
    metadata: {
      immediately: dto.immediately,
      reason: dto.reason,
      cancelledAt: new Date().toISOString(),
    },
  });

  await invalidateTenantBillingCache(tenantId);

  return {
    success: true,
    immediately: dto.immediately,
    cancelAtPeriodEnd: !dto.immediately,
    subscription: updated,
  };
}

export async function listTenantPayments(tenantId: string, query?: ListPaymentsQueryDto) {
  return billingRepo.findPaymentsByTenantId(tenantId, query);
}

export async function listPlatformPayments(query?: ListPlatformPaymentsQueryDto) {
  return billingRepo.listPaymentsForPlatform(query);
}

export async function getPaymentById(id: string, tenantId?: string) {
  const payment = await billingRepo.findPaymentById(id);
  if (!payment) throw AppError.notFound('Payment not found');
  if (tenantId && payment.tenantId !== tenantId) {
    throw AppError.notFound('Payment not found');
  }
  return payment;
}

export async function issuePaymentRefund(
  actorStaffId: string,
  paymentId: string,
  dto: IssueRefundDto,
  requestId?: string,
) {
  // 1. Transaction with FOR UPDATE lock on the payment record
  const { payment, localRefund, isFullRefund, refundAmount } = await db.transaction(async (tx) => {
    const [lockedPayment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update')
      .limit(1);

    if (!lockedPayment) throw AppError.notFound('Payment not found');

    if (lockedPayment.status !== 'PAID' && lockedPayment.status !== 'PARTIALLY_REFUNDED') {
      throw AppError.badRequest(
        `Cannot refund a payment with status "${lockedPayment.status}". Only PAID or PARTIALLY_REFUNDED payments can be refunded.`,
      );
    }

    if (!lockedPayment.providerPaymentId) {
      throw AppError.badRequest('Payment does not have a gateway payment ID to refund');
    }

    const requestedAmount = dto.amountMinor ?? lockedPayment.amountMinor;
    if (requestedAmount <= 0) {
      throw AppError.badRequest('Refund amount must be greater than 0');
    }

    // 2. Sum existing active/pending refunds for this payment
    const existingRefunds = await billingRepo.findRefundsByPaymentId(lockedPayment.id, tx);
    const existingRefundedSum = existingRefunds
      .filter((r) => ['INITIATED', 'PROCESSED', 'PENDING'].includes(r.status))
      .reduce((acc, r) => acc + r.amountMinor, 0);

    const remainingRefundable = lockedPayment.amountMinor - existingRefundedSum;
    if (requestedAmount > remainingRefundable) {
      throw AppError.badRequest(
        `Refund amount (${requestedAmount}) exceeds remaining refundable balance (${remainingRefundable})`,
      );
    }

    // 3. Create local refund row with status PENDING first
    const createdRefund = await billingRepo.createRefund(
      {
        tenantId: lockedPayment.tenantId,
        paymentId: lockedPayment.id,
        provider: 'razorpay',
        amountMinor: requestedAmount,
        currency: lockedPayment.currency,
        status: 'PENDING',
        reason: dto.reason,
        requestedBy: actorStaffId,
      },
      tx,
    );

    const willBeFullRefund = existingRefundedSum + requestedAmount >= lockedPayment.amountMinor;

    return {
      payment: lockedPayment,
      localRefund: createdRefund,
      isFullRefund: willBeFullRefund,
      refundAmount: requestedAmount,
    };
  });

  // 4. Call payment gateway outside the row lock
  const receipt = `rfnd_${localRefund.id.replace(/-/g, '').slice(0, 16)}`;
  let rzpRefund: { id: string; status: string };
  try {
    rzpRefund = await razorpayGateway.createRazorpayRefund({
      paymentId: payment.providerPaymentId!,
      amountMinor: refundAmount,
      receipt,
      notes: {
        reason: dto.reason,
        refundedBy: actorStaffId,
        paymentId: payment.id,
        localRefundId: localRefund.id,
      },
    });
  } catch (err: unknown) {
    // Gateway failed: mark local refund as FAILED and rethrow
    await billingRepo.updateRefund(localRefund.id, {
      status: 'FAILED',
    });
    throw err;
  }

  // 5. Update local refund record with gateway details
  const isProcessed = rzpRefund.status === 'processed';
  const updatedRefund = await billingRepo.updateRefund(localRefund.id, {
    providerRefundId: rzpRefund.id,
    status: isProcessed ? 'PROCESSED' : 'INITIATED',
    processedAt: isProcessed ? new Date() : undefined,
  });

  // 6. Update payment status based on total refunds
  await billingRepo.updatePayment(payment.id, {
    status: isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
  });

  // 7. Policy on full refund: downgrade workspace to FREE plan and log downgrade
  if (isFullRefund) {
    const freePlan = await billingRepo.findPlanByKey(DEFAULT_PLAN_KEY);
    const sub = await billingRepo.findTenantSubscription(payment.tenantId);
    if (freePlan && sub && sub.planId !== freePlan.id) {
      const oldPlan = await billingRepo.findPlanById(sub.planId);
      await billingRepo.updateSubscription(sub.id, {
        planId: freePlan.id,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      });
      await onPlanChanged(payment.tenantId, oldPlan?.key ?? null, freePlan.key);
      await invalidateTenantBillingCache(payment.tenantId);
    }

    await platformRepo.logPlatformAction({
      actorStaffId,
      action: 'payment.full_refund_downgrade',
      targetType: 'tenant',
      targetId: payment.tenantId,
      tenantId: payment.tenantId,
      metadata: {
        paymentId: payment.id,
        refundId: localRefund.id,
        amountMinor: refundAmount,
        downgradedTo: DEFAULT_PLAN_KEY,
      },
      requestId,
    });
  }

  // 8. Operator audit log for the refund
  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'payment.refunded',
    targetType: 'payment',
    targetId: payment.id,
    tenantId: payment.tenantId,
    metadata: {
      refundId: localRefund.id,
      amountMinor: refundAmount,
      reason: dto.reason,
      providerRefundId: rzpRefund.id,
      isFullRefund,
    },
    requestId,
  });

  return updatedRefund ?? localRefund;
}

export async function overrideTenantEntitlements(
  actorStaffId: string,
  tenantId: string,
  dto: OverrideEntitlementsDto,
  requestId?: string,
) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  let sub = await billingRepo.findTenantSubscription(tenantId);
  const fromPlanId = sub?.planId;

  let targetPlanId = sub?.planId;
  let targetPlanKey = tenant.plan;

  if (dto.planKey) {
    const plan = await billingRepo.findPlanByKey(dto.planKey);
    if (!plan) throw AppError.notFound(`Plan "${dto.planKey}" not found`);
    targetPlanId = plan.id;
    targetPlanKey = plan.key;
  }

  if (sub) {
    sub = await billingRepo.updateSubscription(sub.id, {
      ...(targetPlanId ? { planId: targetPlanId } : {}),
      ...(dto.status ? { status: dto.status as any } : {}),
      ...(dto.currentPeriodEnd ? { currentPeriodEnd: dto.currentPeriodEnd } : {}),
      internalNotes: `Manual staff override: ${dto.reason}`,
    });
  } else if (targetPlanId) {
    sub = await billingRepo.createSubscription({
      tenantId,
      planId: targetPlanId,
      status: (dto.status as any) ?? 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: dto.currentPeriodEnd,
      internalNotes: `Manual staff override: ${dto.reason}`,
      provider: 'manual',
    });
  }

  await db
    .update(tenants)
    .set({ plan: targetPlanKey, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  await billingRepo.createSubscriptionEvent({
    subscriptionId: sub!.id,
    tenantId,
    type: 'STAFF_OVERRIDE',
    fromPlanId,
    toPlanId: targetPlanId,
    actorType: 'PLATFORM_STAFF',
    actorId: actorStaffId,
    metadata: { reason: dto.reason, dto },
  });

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.subscription_override',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    metadata: { reason: dto.reason, dto },
    requestId,
  });

  await invalidateTenantBillingCache(tenantId);

  return billingRepo.findTenantSubscriptionWithPlan(tenantId);
}
