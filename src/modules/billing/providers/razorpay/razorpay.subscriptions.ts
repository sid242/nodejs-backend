import { logger } from '@/config/logger';
import { AppError } from '@/lib/errors';

import { getRazorpayClient } from './razorpay.client';

export interface CreateSubscriptionPlanParams {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  name: string;
  amountMinor: number;
  currency: string;
  description?: string;
  notes?: Record<string, string>;
}

export interface CreateSubscriptionParams {
  planId: string; // Razorpay Plan ID (plan_xxx)
  totalCount: number; // e.g. 12 for 1 year of monthly, or 120 for 10 years
  quantity?: number;
  customerNotify?: 0 | 1;
  startAt?: number; // Unix timestamp
  notes?: Record<string, string>;
}

export interface RazorpaySubscriptionResult {
  id: string;
  entity: string;
  plan_id: string;
  status: string; // 'created' | 'authenticated' | 'active' | 'pending' | 'halted' | 'cancelled' | 'completed' | 'expired'
  current_start: number | null;
  current_end: number | null;
  ended_at: number | null;
  quantity: number;
  notes: Record<string, string>;
  charge_at: number | null;
  start_at: number | null;
  end_at: number | null;
  auth_attempts: number;
  total_count: number;
  paid_count: number;
  customer_notify: boolean;
  created_at: number;
  short_url?: string;
}

/**
 * Creates or ensures a plan in Razorpay for recurring billing.
 */
export async function createRazorpayPlan(
  params: CreateSubscriptionPlanParams,
): Promise<{ id: string; name: string; amount: number; currency: string }> {
  const razorpay = getRazorpayClient();

  try {
    const plan = await razorpay.plans.create({
      period: params.period,
      interval: params.interval,
      item: {
        name: params.name,
        amount: params.amountMinor,
        currency: params.currency,
        description: params.description,
      },
      notes: params.notes ?? {},
    });

    return plan as any;
  } catch (error: any) {
    logger.error({ error, params }, 'Failed to create Razorpay plan');
    throw AppError.badRequest(
      error?.error?.description ??
        error?.message ??
        'Failed to initialize subscription plan with payment gateway',
    );
  }
}

/**
 * Creates a recurring subscription in Razorpay.
 */
export async function createRazorpaySubscription(
  params: CreateSubscriptionParams,
): Promise<RazorpaySubscriptionResult> {
  const razorpay = getRazorpayClient();

  try {
    const subscription = await razorpay.subscriptions.create({
      plan_id: params.planId,
      total_count: params.totalCount,
      quantity: params.quantity ?? 1,
      customer_notify: params.customerNotify ?? 1,
      start_at: params.startAt,
      notes: params.notes ?? {},
    });

    return subscription as unknown as RazorpaySubscriptionResult;
  } catch (error: any) {
    logger.error(
      { error, params: { ...params, notes: undefined } },
      'Failed to create Razorpay subscription',
    );
    throw AppError.badRequest(
      error?.error?.description ??
        error?.message ??
        'Failed to initialize subscription with payment gateway',
    );
  }
}

/**
 * Fetches current subscription details from Razorpay.
 */
export async function fetchRazorpaySubscription(
  subscriptionId: string,
): Promise<RazorpaySubscriptionResult> {
  const razorpay = getRazorpayClient();

  try {
    const subscription = await razorpay.subscriptions.fetch(subscriptionId);
    return subscription as unknown as RazorpaySubscriptionResult;
  } catch (error: any) {
    logger.error({ error, subscriptionId }, 'Failed to fetch Razorpay subscription');
    throw AppError.notFound('Subscription not found in payment gateway');
  }
}

/**
 * Cancels a subscription in Razorpay.
 * cancelAtCycleEnd: false = cancel immediately; true = cancel at current period end.
 */
export async function cancelRazorpaySubscription(
  subscriptionId: string,
  cancelAtCycleEnd = false,
): Promise<RazorpaySubscriptionResult> {
  const razorpay = getRazorpayClient();

  try {
    const result = await razorpay.subscriptions.cancel(subscriptionId, cancelAtCycleEnd);
    return result as unknown as RazorpaySubscriptionResult;
  } catch (error: any) {
    logger.error(
      { error, subscriptionId, cancelAtCycleEnd },
      'Failed to cancel Razorpay subscription',
    );
    throw AppError.badRequest(
      error?.error?.description ??
        error?.message ??
        'Failed to cancel subscription in payment gateway',
    );
  }
}
