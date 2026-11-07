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
import {
  cancelRazorpaySubscription,
  createRazorpayOrder,
  createRazorpayPlan,
  createRazorpayRefund,
  createRazorpaySubscription,
  fetchRazorpayPayment,
  verifyOrderPaymentSignature,
  verifySubscriptionPaymentSignature,
} from './providers/razorpay';

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

  // 1. Generic & Stripe style events
  if (eventType === 'customer.subscription.updated' || eventType === 'subscription.updated') {
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

  // 2. Razorpay specific webhook events
  if (provider === 'razorpay') {
    const pEntity = (payload as any)?.payload?.payment?.entity;
    const oEntity = (payload as any)?.payload?.order?.entity;
    const sEntity = (payload as any)?.payload?.subscription?.entity;
    const rEntity = (payload as any)?.payload?.refund?.entity;

    // Handle payment.captured / order.paid
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      const orderId = pEntity?.order_id ?? oEntity?.id;
      const paymentId = pEntity?.id;

      if (orderId) {
        const localPayment = await billingRepo.findPaymentByOrderId(orderId);
        if (localPayment && localPayment.status !== 'PAID') {
          await billingRepo.updatePayment(localPayment.id, {
            status: 'PAID',
            providerPaymentId: paymentId ?? localPayment.providerPaymentId,
            paidAt: new Date(),
          });

          // Ensure subscription is active if not already activated
          const meta = localPayment.metadata as any;
          if (meta?.planKey && localPayment.tenantId) {
            const plan = await billingRepo.findPlanByKey(meta.planKey);
            if (plan) {
              const sub = await billingRepo.findTenantSubscription(localPayment.tenantId);
              const intervalDays = meta.billingInterval === 'ANNUAL' ? 365 : 30;
              const periodEnd = new Date(Date.now() + intervalDays * 86400000);

              if (sub) {
                await billingRepo.updateSubscription(sub.id, {
                  planId: plan.id,
                  status: 'ACTIVE',
                  currentPeriodStart: new Date(),
                  currentPeriodEnd: periodEnd,
                  provider: 'razorpay',
                });
              } else {
                await billingRepo.createSubscription({
                  tenantId: localPayment.tenantId,
                  planId: plan.id,
                  status: 'ACTIVE',
                  currentPeriodStart: new Date(),
                  currentPeriodEnd: periodEnd,
                  provider: 'razorpay',
                });
              }

              await onPlanChanged(localPayment.tenantId, sub?.planId ?? '', plan.key);
            }
          }
        }
      }
    } else if (eventType === 'payment.failed') {
      const orderId = pEntity?.order_id ?? oEntity?.id;
      if (orderId) {
        const localPayment = await billingRepo.findPaymentByOrderId(orderId);
        if (localPayment) {
          await billingRepo.updatePayment(localPayment.id, {
            status: 'FAILED',
            failureCode: pEntity?.error_code ?? 'PAYMENT_FAILED',
            failureDescription: pEntity?.error_description ?? 'Payment attempt failed',
          });
        }
      }
    } else if (
      eventType === 'subscription.authenticated' ||
      eventType === 'subscription.activated' ||
      eventType === 'subscription.charged'
    ) {
      const rzpSubId = sEntity?.id;
      const notes = sEntity?.notes ?? {};
      const tenantId = notes.tenantId;
      const planKey = notes.planKey;

      if (rzpSubId && tenantId) {
        const sub = await billingRepo.findTenantSubscription(tenantId);
        const plan = planKey ? await billingRepo.findPlanByKey(planKey) : null;

        const currentPeriodStart = sEntity?.current_start
          ? new Date(sEntity.current_start * 1000)
          : new Date();
        const currentPeriodEnd = sEntity?.current_end
          ? new Date(sEntity.current_end * 1000)
          : new Date(Date.now() + 30 * 86400000);

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
          await onPlanChanged(tenantId, sub?.planId ?? '', plan.key);
        } else {
          await invalidateTenantBillingCache(tenantId);
        }
      }
    } else if (eventType === 'subscription.halted' || eventType === 'subscription.pending') {
      const notes = sEntity?.notes ?? {};
      const tenantId = notes.tenantId;
      if (tenantId) {
        const sub = await billingRepo.findTenantSubscription(tenantId);
        if (sub) {
          await billingRepo.updateSubscription(sub.id, {
            status: 'PAST_DUE',
          });
          await invalidateTenantBillingCache(tenantId);
        }
      }
    } else if (eventType === 'subscription.cancelled' || eventType === 'subscription.completed') {
      const notes = sEntity?.notes ?? {};
      const tenantId = notes.tenantId;
      if (tenantId) {
        const sub = await billingRepo.findTenantSubscription(tenantId);
        if (sub) {
          await billingRepo.updateSubscription(sub.id, {
            status: 'CANCELED',
          });
          await invalidateTenantBillingCache(tenantId);
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

// ==========================================
// 7. Razorpay Checkout, Payments & Refunds
// ==========================================

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

  // 2. Call Razorpay Orders API
  const receipt = `rcpt_${tenantId.slice(0, 8)}_${Date.now()}`;
  const order = await createRazorpayOrder({
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
  const isValid = verifyOrderPaymentSignature({
    orderId: dto.razorpay_order_id,
    paymentId: dto.razorpay_payment_id,
    signature: dto.razorpay_signature,
  });

  if (!isValid) {
    throw AppError.badRequest('Invalid payment signature from payment gateway');
  }

  // 4. Fetch payment details from Razorpay to confirm capture
  const rzpPayment = await fetchRazorpayPayment(dto.razorpay_payment_id);
  if (rzpPayment.status !== 'captured' && rzpPayment.status !== 'authorized') {
    throw AppError.badRequest(`Payment status is not captured (current: ${rzpPayment.status})`);
  }

  // 5. Update local payment record to PAID
  await billingRepo.updatePayment(localPayment.id, {
    status: 'PAID',
    providerPaymentId: dto.razorpay_payment_id,
    providerSignature: dto.razorpay_signature,
    paymentMethod: rzpPayment.method,
    paidAt: new Date(),
  });

  // 6. Activate/Renew tenant subscription
  const meta = (localPayment.metadata ?? {}) as Record<string, any>;
  const targetPlanKey = (meta.planKey ?? 'PRO').toUpperCase();
  const plan =
    (await billingRepo.findPlanByKey(targetPlanKey)) ??
    (await billingRepo.findPlanById(meta.planId));
  if (!plan) throw AppError.notFound(`Plan "${targetPlanKey}" not found`);

  const isAnnual = meta.billingInterval === 'ANNUAL';
  const durationDays = isAnnual ? 365 : 30;
  const currentPeriodStart = new Date();
  const currentPeriodEnd = new Date(Date.now() + durationDays * 86400000);

  let sub = await billingRepo.findTenantSubscription(tenantId);
  const fromPlanId = sub?.planId;

  if (sub) {
    sub = await billingRepo.updateSubscription(sub.id, {
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodStart,
      currentPeriodEnd,
      billingInterval: isAnnual ? 'ANNUAL' : 'MONTHLY',
      cancelAtPeriodEnd: false,
      provider: 'razorpay',
    });
  } else {
    sub = await billingRepo.createSubscription({
      tenantId,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodStart,
      currentPeriodEnd,
      billingInterval: isAnnual ? 'ANNUAL' : 'MONTHLY',
      provider: 'razorpay',
    });
  }

  // 7. Auto-generate paid invoice
  await billingRepo.createInvoice({
    tenantId,
    subscriptionId: sub!.id,
    planId: plan.id,
    amountCents: localPayment.amountMinor,
    taxCents: 0,
    currency: localPayment.currency,
    status: 'PAID',
    paidAt: new Date(),
    billingPeriodStart: currentPeriodStart,
    billingPeriodEnd: currentPeriodEnd,
    lineItems: [
      {
        description: `${plan.name} Plan (${isAnnual ? 'Annual' : 'Monthly'})`,
        quantity: 1,
        unitPriceCents: localPayment.amountMinor,
        totalCents: localPayment.amountMinor,
      },
    ],
  });

  // 8. Log subscription event
  await billingRepo.createSubscriptionEvent({
    subscriptionId: sub!.id,
    tenantId,
    type: 'PURCHASED',
    fromPlanId,
    toPlanId: plan.id,
    actorType: 'USER',
    actorId: actorUserId,
    metadata: {
      orderId: dto.razorpay_order_id,
      paymentId: dto.razorpay_payment_id,
      planKey: plan.key,
      billingInterval: isAnnual ? 'ANNUAL' : 'MONTHLY',
    },
  });

  // 9. Synchronize plan and notify
  const oldPlan = fromPlanId ? await billingRepo.findPlanById(fromPlanId) : null;
  if (oldPlan && oldPlan.key !== plan.key) {
    await onPlanChanged(tenantId, oldPlan.key, plan.key);
  } else {
    await invalidateTenantBillingCache(tenantId);
  }

  // 10. Real-time push notification
  emitToUser(actorUserId, 'billing:payment_success', {
    orderId: dto.razorpay_order_id,
    paymentId: dto.razorpay_payment_id,
    planKey: plan.key,
    planName: plan.name,
  });

  return {
    success: true,
    status: 'PAID',
    planKey: plan.key,
    planName: plan.name,
    subscriptionId: sub!.id,
    paymentId: localPayment.id,
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

  // Create a recurring Razorpay plan
  const rzpPlan = await createRazorpayPlan({
    period: isAnnual ? 'yearly' : 'monthly',
    interval: 1,
    name: `${plan.name} (${isAnnual ? 'Annual' : 'Monthly'})`,
    amountMinor,
    currency: plan.currency || env.RAZORPAY_CURRENCY || 'INR',
    description: plan.description ?? undefined,
  });

  // Create recurring subscription in Razorpay
  const rzpSub = await createRazorpaySubscription({
    planId: rzpPlan.id,
    totalCount: dto.totalCount,
    notes: {
      tenantId,
      tenantSlug: tenant.slug,
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
  const isValid = verifySubscriptionPaymentSignature({
    subscriptionId: dto.razorpay_subscription_id,
    paymentId: dto.razorpay_payment_id,
    signature: dto.razorpay_signature,
  });

  if (!isValid) {
    throw AppError.badRequest('Invalid recurring subscription signature');
  }

  // 2. Fetch payment from Razorpay
  const rzpPayment = await fetchRazorpayPayment(dto.razorpay_payment_id);

  // 3. Update or create local subscription
  let sub = await billingRepo.findTenantSubscription(tenantId);
  const currentPeriodStart = new Date();
  const currentPeriodEnd = new Date(Date.now() + 30 * 86400000);

  if (sub) {
    sub = await billingRepo.updateSubscription(sub.id, {
      status: 'ACTIVE',
      provider: 'razorpay',
      providerSubscriptionId: dto.razorpay_subscription_id,
      currentPeriodStart,
      currentPeriodEnd,
    });
  }

  // 4. Record local payment
  const payment = await billingRepo.createPayment({
    tenantId,
    subscriptionId: sub?.id,
    provider: 'razorpay',
    providerPaymentId: dto.razorpay_payment_id,
    providerSignature: dto.razorpay_signature,
    amountMinor: Number(rzpPayment.amount ?? 0),
    currency: rzpPayment.currency ?? 'INR',
    status: 'PAID',
    paymentMethod: rzpPayment.method,
    paidAt: new Date(),
  });

  emitToUser(actorUserId, 'billing:subscription_activated', {
    subscriptionId: dto.razorpay_subscription_id,
    paymentId: dto.razorpay_payment_id,
  });

  return {
    success: true,
    status: 'ACTIVE',
    paymentId: payment.id,
    subscriptionId: sub?.id,
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
    await cancelRazorpaySubscription(sub.providerSubscriptionId, !dto.immediately);
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
  const payment = await billingRepo.findPaymentById(paymentId);
  if (!payment) throw AppError.notFound('Payment not found');

  if (payment.status !== 'PAID') {
    throw AppError.badRequest(`Cannot refund a payment with status "${payment.status}"`);
  }

  if (!payment.providerPaymentId) {
    throw AppError.badRequest('Payment does not have a gateway payment ID to refund');
  }

  const refundAmount = dto.amountMinor ?? payment.amountMinor;

  // 1. Call Razorpay Refund API
  const rzpRefund = await createRazorpayRefund({
    paymentId: payment.providerPaymentId,
    amountMinor: refundAmount,
    notes: {
      reason: dto.reason,
      refundedBy: actorStaffId,
      paymentId: payment.id,
    },
  });

  // 2. Persist local refund record
  const localRefund = await billingRepo.createRefund({
    tenantId: payment.tenantId,
    paymentId: payment.id,
    provider: 'razorpay',
    providerRefundId: rzpRefund.id,
    amountMinor: refundAmount,
    currency: payment.currency,
    status: rzpRefund.status === 'processed' ? 'PROCESSED' : 'INITIATED',
    reason: dto.reason,
    requestedBy: actorStaffId,
    processedAt: rzpRefund.status === 'processed' ? new Date() : undefined,
  });

  // 3. Update payment status
  const isFullRefund = refundAmount >= payment.amountMinor;
  await billingRepo.updatePayment(payment.id, {
    status: isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
  });

  // 4. Operator audit log
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
    },
    requestId,
  });

  return localRefund;
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
