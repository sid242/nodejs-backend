import Razorpay from 'razorpay';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { AppError } from '@/lib/errors';

let razorpayInstance: Razorpay | null = null;

/**
 * Returns the singleton Razorpay instance initialized with backend credentials.
 * Fails fast with a clear error if credentials are not configured.
 */
export function getRazorpayClient(): Razorpay {
  if (razorpayInstance) {
    return razorpayInstance;
  }

  const key_id = env.RAZORPAY_KEY_ID;
  const key_secret = env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    logger.warn(
      'Razorpay credentials missing. Ensure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set.',
    );
    throw AppError.badRequest(
      'Razorpay payment gateway is not properly configured on this server.',
    );
  }

  razorpayInstance = new Razorpay({
    key_id,
    key_secret,
  });

  return razorpayInstance;
}

export function isRazorpayConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}
