import crypto from 'node:crypto';

import { env } from '@/config/env';
import { AppError } from '@/lib/errors';

/**
 * Validates Razorpay standard checkout payment signature for Orders:
 * HMAC SHA256 of `${orderId}|${paymentId}` using RAZORPAY_KEY_SECRET.
 */
export function verifyOrderPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    throw AppError.internal('Razorpay key secret not configured');
  }

  const payload = `${params.orderId}|${params.paymentId}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const signatureBuffer = Buffer.from(params.signature, 'utf8');

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

/**
 * Validates Razorpay recurring subscription payment signature:
 * HMAC SHA256 of `${paymentId}|${subscriptionId}` using RAZORPAY_KEY_SECRET.
 */
export function verifySubscriptionPaymentSignature(params: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
}): boolean {
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    throw AppError.internal('Razorpay key secret not configured');
  }

  const payload = `${params.paymentId}|${params.subscriptionId}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const signatureBuffer = Buffer.from(params.signature, 'utf8');

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

/**
 * Validates Razorpay Webhook signature:
 * HMAC SHA256 of the raw request body bytes using RAZORPAY_WEBHOOK_SECRET.
 */
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw AppError.internal('Razorpay webhook secret not configured');
  }

  const hmac = crypto.createHmac('sha256', webhookSecret);
  if (Buffer.isBuffer(rawBody)) {
    hmac.update(rawBody);
  } else {
    hmac.update(rawBody, 'utf8');
  }

  const expectedSignature = hmac.digest('hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const signatureBuffer = Buffer.from(signature, 'utf8');

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}
