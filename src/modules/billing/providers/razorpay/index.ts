import type { Request } from 'express';

import { env } from '@/config/env';
import type { Subscription, Tenant } from '@/db/schema/index';
import { AppError } from '@/lib/errors';
import { billingRepo } from '@/modules/billing/billing.repository';

import type { BillingProvider, CheckoutResult, WebhookResult } from '../../provider';
import { createRazorpayOrder } from './razorpay.orders';
import { cancelRazorpaySubscription } from './razorpay.subscriptions';
import { parseAndVerifyRazorpayWebhook } from './razorpay.webhooks';

export * from './razorpay.client';
export * from './razorpay.orders';
export * from './razorpay.refunds';
export * from './razorpay.signature';
export * from './razorpay.subscriptions';
export * from './razorpay.webhooks';

export class RazorpayBillingProvider implements BillingProvider {
  public readonly name = 'razorpay';

  /**
   * Initializes a one-time order checkout for a plan.
   */
  public async createCheckout(tenant: Tenant, planKey: string): Promise<CheckoutResult> {
    const plan = await billingRepo.findPlanByKey(planKey);
    if (!plan) {
      throw AppError.notFound(`Plan "${planKey}" not found`);
    }

    if (!plan.isActive) {
      throw AppError.badRequest(`Plan "${planKey}" is not currently available for purchase`);
    }

    const amountMinor = plan.priceMonthlyMinor;
    if (amountMinor <= 0) {
      throw AppError.badRequest(`Plan "${planKey}" does not require payment checkout (free plan)`);
    }

    const keyId = env.RAZORPAY_KEY_ID;
    if (!keyId) {
      throw AppError.internal('Razorpay key ID is not configured on the server');
    }

    const receipt = `rcpt_${tenant.id.slice(0, 8)}_${Date.now()}`;
    const order = await createRazorpayOrder({
      amountMinor,
      currency: plan.currency || env.RAZORPAY_CURRENCY || 'INR',
      receipt,
      notes: {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        planKey: plan.key,
        planId: plan.id,
      },
    });

    return {
      keyId,
      providerOrderId: order.id,
      amountMinor: order.amount,
      currency: order.currency,
      planName: plan.name,
    };
  }

  /**
   * Cancels an active recurring subscription at Razorpay gateway.
   */
  public async cancel(subscription: Subscription): Promise<void> {
    if (subscription.providerSubscriptionId) {
      await cancelRazorpaySubscription(subscription.providerSubscriptionId, true);
    }
  }

  /**
   * Verifies incoming webhook signature against raw request body and normalizes the payload.
   */
  public async parseWebhook(req: Request): Promise<WebhookResult> {
    const { result } = parseAndVerifyRazorpayWebhook(req);
    return result;
  }
}

export const razorpayBillingProvider = new RazorpayBillingProvider();
