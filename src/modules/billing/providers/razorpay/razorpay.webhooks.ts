import type { Request } from 'express';

import { logger } from '@/config/logger';
import { AppError } from '@/lib/errors';

import type { WebhookResult } from '../../provider';
import { verifyWebhookSignature } from './razorpay.signature';

export interface RazorpayWebhookPayload {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    payment?: {
      entity: {
        id: string;
        entity: string;
        amount: number;
        currency: string;
        status: string;
        order_id?: string;
        invoice_id?: string;
        method?: string;
        error_code?: string | null;
        error_description?: string | null;
        notes?: Record<string, string>;
        [key: string]: any;
      };
    };
    order?: {
      entity: {
        id: string;
        entity: string;
        amount: number;
        amount_paid: number;
        status: string;
        receipt: string;
        notes?: Record<string, string>;
        [key: string]: any;
      };
    };
    subscription?: {
      entity: {
        id: string;
        entity: string;
        plan_id: string;
        status: string;
        current_start: number | null;
        current_end: number | null;
        ended_at: number | null;
        notes?: Record<string, string>;
        [key: string]: any;
      };
    };
    refund?: {
      entity: {
        id: string;
        entity: string;
        amount: number;
        currency: string;
        payment_id: string;
        status: string;
        notes?: Record<string, string>;
        [key: string]: any;
      };
    };
  };
  created_at: number;
}

/**
 * Validates the raw body against X-Razorpay-Signature and parses standard Razorpay webhook.
 */
export function parseAndVerifyRazorpayWebhook(req: Request): {
  event: RazorpayWebhookPayload;
  result: WebhookResult;
} {
  const signature = req.headers['x-razorpay-signature'] as string | undefined;

  if (!signature) {
    throw AppError.badRequest('Missing X-Razorpay-Signature header');
  }

  // Use rawBody buffer captured by express.json verify middleware
  const rawBody = req.rawBody;
  if (!rawBody || rawBody.length === 0) {
    // If rawBody wasn't populated, fallback to JSON.stringify if body is parsed (less resilient, but safe if verified)
    const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const valid = verifyWebhookSignature(bodyStr, signature);
    if (!valid) {
      logger.warn('Razorpay webhook signature verification failed (fallback string)');
      throw AppError.badRequest('Invalid webhook signature');
    }
  } else {
    const valid = verifyWebhookSignature(rawBody, signature);
    if (!valid) {
      logger.warn('Razorpay webhook signature verification failed');
      throw AppError.badRequest('Invalid webhook signature');
    }
  }

  const payload: RazorpayWebhookPayload =
    typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body);

  const eventType = payload.event;
  const notes =
    payload.payload?.subscription?.entity?.notes ??
    payload.payload?.order?.entity?.notes ??
    payload.payload?.payment?.entity?.notes ??
    {};

  const tenantId = notes.tenantId;
  const subscriptionId = notes.subscriptionId;

  return {
    event: payload,
    result: {
      eventType,
      tenantId,
      subscriptionId,
      status:
        payload.payload?.subscription?.entity?.status ??
        payload.payload?.payment?.entity?.status ??
        payload.payload?.order?.entity?.status,
      metadata: notes,
    },
  };
}
