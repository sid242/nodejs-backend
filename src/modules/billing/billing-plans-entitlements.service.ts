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
import { tenantsRepo } from '@/modules/tenants/tenants.repository';
import { emailQueue } from '@/queues/index';

import type {
  CreatePlanDto,
  ListPlansQueryDto,
  OverrideEntitlementsDto,
  SetTenantEntitlementOverrideDto,
  UpdatePlanDto,
} from './billing.dto';
import { billingRepo } from './billing.repository';
import {
  DEFAULT_ENTITLEMENT_DEFINITIONS,
  DEFAULT_PLAN_ENTITLEMENT_VALUES,
} from './entitlements.defaults';
import { DEFAULT_PLAN_KEY, DEFAULT_PLANS } from './plans.defaults';

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
    let currentUsage: number;

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
