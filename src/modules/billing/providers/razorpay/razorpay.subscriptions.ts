import { logger } from '@/config/logger';
import { AppError } from '@/lib/errors';

import { executeGatewayCall, getRazorpayClient } from './razorpay.client';

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
  return executeGatewayCall(
    async () => {
      const razorpay = getRazorpayClient();
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

      return plan as unknown as { id: string; name: string; amount: number; currency: string };
    },
    { operationName: 'Create Razorpay plan' },
  );
}

/**
 * Creates a recurring subscription in Razorpay.
 */
export async function createRazorpaySubscription(
  params: CreateSubscriptionParams,
): Promise<RazorpaySubscriptionResult> {
  return executeGatewayCall(
    async () => {
      const razorpay = getRazorpayClient();
      const subscription = await razorpay.subscriptions.create({
        plan_id: params.planId,
        total_count: params.totalCount,
        quantity: params.quantity ?? 1,
        customer_notify: params.customerNotify ?? 1,
        start_at: params.startAt,
        notes: params.notes ?? {},
      });

      return subscription as unknown as RazorpaySubscriptionResult;
    },
    { operationName: 'Create Razorpay subscription' },
  );
}

/**
 * Fetches current subscription details from Razorpay.
 */
export async function fetchRazorpaySubscription(
  subscriptionId: string,
): Promise<RazorpaySubscriptionResult> {
  return executeGatewayCall(
    async () => {
      const razorpay = getRazorpayClient();
      const subscription = await razorpay.subscriptions.fetch(subscriptionId);
      return subscription as unknown as RazorpaySubscriptionResult;
    },
    { isGet: true, operationName: 'Fetch Razorpay subscription' },
  );
}

/**
 * Cancels a subscription in Razorpay.
 * cancelAtCycleEnd: false = cancel immediately; true = cancel at current period end.
 * Redundant cancellation requests ("already cancelled") are treated as idempotent success.
 */
export async function cancelRazorpaySubscription(
  subscriptionId: string,
  cancelAtCycleEnd = false,
): Promise<RazorpaySubscriptionResult> {
  try {
    return await executeGatewayCall(
      async () => {
        const razorpay = getRazorpayClient();
        const result = await razorpay.subscriptions.cancel(subscriptionId, cancelAtCycleEnd);
        return result as unknown as RazorpaySubscriptionResult;
      },
      { operationName: 'Cancel Razorpay subscription' },
    );
  } catch (error: unknown) {
    let msg = '';
    if (error instanceof AppError && error.details) {
      msg = String((error.details as Record<string, unknown>).originalError ?? '');
    } else if (error && typeof error === 'object') {
      const rec = error as Record<string, unknown>;
      msg = String(rec.message ?? '');
      if (rec.error && typeof rec.error === 'object') {
        msg += ' ' + String((rec.error as Record<string, unknown>).description ?? '');
      }
    }
    const lowerMsg = msg.toLowerCase();
    if (
      lowerMsg.includes('already cancelled') ||
      lowerMsg.includes('already canceled') ||
      lowerMsg.includes('in cancelled state') ||
      lowerMsg.includes('in canceled state')
    ) {
      logger.info(
        { subscriptionId },
        'Razorpay subscription already cancelled, treating as success',
      );
      return {
        id: subscriptionId,
        entity: 'subscription',
        plan_id: '',
        status: 'cancelled',
        current_start: null,
        current_end: null,
        ended_at: Math.floor(Date.now() / 1000),
        quantity: 1,
        notes: {},
        charge_at: null,
        start_at: null,
        end_at: null,
        auth_attempts: 0,
        total_count: 0,
        paid_count: 0,
        customer_notify: false,
        created_at: Math.floor(Date.now() / 1000),
      };
    }
    throw error;
  }
}
