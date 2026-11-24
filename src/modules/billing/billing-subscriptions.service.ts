import { eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { tenants } from '@/db/schema';
import { AppError } from '@/lib/errors';
import * as platformRepo from '@/modules/platform/platform.repository';

import {
  getTenantEntitlements,
  invalidateTenantBillingCache,
  onPlanChanged,
} from './billing-plans-entitlements.service';
import type {
  AssignSubscriptionDto,
  CancelSubscriptionDto,
  ListPlatformSubscriptionsQueryDto,
  SubscriptionChangeRequestDto,
  UpdateSubscriptionDto,
} from './billing.dto';
import { billingRepo } from './billing.repository';
import { DEFAULT_PLAN_KEY } from './plans.defaults';
import { razorpayGateway } from './providers/razorpay';

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
  const maxMembers = entitlements.limits.maxMembers;

  return {
    subscription: sub,
    plan: {
      key: entitlements.planKey,
      name: entitlements.planName,
      limits: entitlements.limits,
      effectiveModules: entitlements.effectiveModules,
    },
    usage: {
      ...usage,
      activeMembers: usage.activeMembers ?? usage.members,
      maxMembers,
      remainingSeats: maxMembers === null ? null : Math.max(0, maxMembers - usage.members),
    },
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
