import { logger } from '@/config/logger';
import { AppError } from '@/lib/errors';

import { getRazorpayClient } from './razorpay.client';

export interface CreateOrderParams {
  amountMinor: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResult {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
}

export async function createRazorpayOrder(params: CreateOrderParams): Promise<RazorpayOrderResult> {
  const razorpay = getRazorpayClient();

  try {
    const order = await razorpay.orders.create({
      amount: params.amountMinor,
      currency: params.currency,
      receipt: params.receipt,
      notes: params.notes ?? {},
    });

    return order as unknown as RazorpayOrderResult;
  } catch (error: any) {
    logger.error(
      { error, params: { ...params, notes: undefined } },
      'Failed to create Razorpay order',
    );
    throw AppError.badRequest(
      error?.error?.description ??
        error?.message ??
        'Failed to initialize payment order with payment gateway',
    );
  }
}

export async function fetchRazorpayOrder(orderId: string): Promise<RazorpayOrderResult> {
  const razorpay = getRazorpayClient();

  try {
    const order = await razorpay.orders.fetch(orderId);
    return order as unknown as RazorpayOrderResult;
  } catch (error: any) {
    logger.error({ error, orderId }, 'Failed to fetch Razorpay order');
    throw AppError.notFound('Payment order not found in payment gateway');
  }
}

export async function fetchRazorpayPayment(paymentId: string): Promise<any> {
  const razorpay = getRazorpayClient();

  try {
    const payment = await razorpay.payments.fetch(paymentId);
    return payment;
  } catch (error: any) {
    logger.error({ error, paymentId }, 'Failed to fetch Razorpay payment');
    throw AppError.notFound('Payment not found in payment gateway');
  }
}
