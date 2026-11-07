import { logger } from '@/config/logger';
import { AppError } from '@/lib/errors';

import { getRazorpayClient } from './razorpay.client';

export interface CreateRefundParams {
  paymentId: string;
  amountMinor?: number; // Optional: if omitted, full refund
  notes?: Record<string, string>;
  speed?: 'normal' | 'optimum';
}

export interface RazorpayRefundResult {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  payment_id: string;
  notes: Record<string, string>;
  receipt: string | null;
  acquirer_data?: Record<string, any>;
  created_at: number;
  batch_id: string | null;
  status: string; // 'pending' | 'processed' | 'failed'
  speed_processed: string;
  speed_requested: string;
}

export async function createRazorpayRefund(
  params: CreateRefundParams,
): Promise<RazorpayRefundResult> {
  const razorpay = getRazorpayClient();

  try {
    const payload: any = {
      notes: params.notes ?? {},
    };
    if (params.amountMinor !== undefined) {
      payload.amount = params.amountMinor;
    }
    if (params.speed) {
      payload.speed = params.speed;
    }

    const refund = await razorpay.payments.refund(params.paymentId, payload);
    return refund as unknown as RazorpayRefundResult;
  } catch (error: any) {
    logger.error(
      { error, params: { ...params, notes: undefined } },
      'Failed to issue Razorpay refund',
    );
    throw AppError.badRequest(
      error?.error?.description ??
        error?.message ??
        'Failed to process refund with payment gateway',
    );
  }
}

export async function fetchRazorpayRefund(
  paymentId: string,
  refundId: string,
): Promise<RazorpayRefundResult> {
  const razorpay = getRazorpayClient();

  try {
    const refund = await (razorpay.refunds as any).fetch(refundId);
    return refund as unknown as RazorpayRefundResult;
  } catch (error: any) {
    logger.error({ error, paymentId, refundId }, 'Failed to fetch Razorpay refund');
    throw AppError.notFound('Refund not found in payment gateway');
  }
}
