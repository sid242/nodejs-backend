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

export interface GatewayCallOptions {
  timeoutMs?: number;
  isGet?: boolean;
  operationName?: string;
}

function extractGatewayErrorDetails(err: unknown): {
  statusCode?: number;
  description?: string;
  code?: string;
} {
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    const status =
      typeof rec.status === 'number'
        ? rec.status
        : typeof rec.statusCode === 'number'
          ? rec.statusCode
          : undefined;
    let description: string | undefined;
    let code: string | undefined;

    if (rec.error && typeof rec.error === 'object') {
      const errSub = rec.error as Record<string, unknown>;
      if (typeof errSub.description === 'string') description = errSub.description;
      if (typeof errSub.code === 'string') code = errSub.code;
    }
    if (!description && typeof rec.message === 'string') {
      description = rec.message;
    }

    return { statusCode: status, description, code };
  }
  return {};
}

/**
 * Resilient wrapper around Razorpay client calls.
 * Enforces a 10s timeout, retries GET calls up to 2 times on transient failures,
 * logs gateway details internally and returns a generic 502 AppError to callers.
 */
export async function executeGatewayCall<T>(
  fn: () => Promise<T>,
  options: GatewayCallOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const isGet = options.isGet ?? false;
  const opName = options.operationName ?? 'Razorpay call';

  const runWithTimeout = async (): Promise<T> => {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AppError(504, 'Payment gateway request timed out', 'GATEWAY_TIMEOUT'));
      }, timeoutMs);
    });

    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  if (!isGet) {
    try {
      return await runWithTimeout();
    } catch (error: unknown) {
      if (error instanceof AppError && error.status === 504) throw error;
      const details = extractGatewayErrorDetails(error);
      logger.error({ error, opName }, `${opName} failed`);
      throw new AppError(502, 'Payment gateway error', 'GATEWAY_ERROR', {
        operation: opName,
        originalError: details.description,
      });
    }
  }

  // GET retry once on 5xx or transient failure
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await runWithTimeout();
    } catch (error: unknown) {
      lastErr = error;
      const details = extractGatewayErrorDetails(error);
      if (details.statusCode === 404 || details.code === 'BAD_REQUEST_ERROR') {
        throw AppError.notFound(`${opName}: Resource not found in payment gateway`);
      }
      logger.warn({ attempt, error, opName }, `${opName} failed on attempt ${attempt}`);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  const details = extractGatewayErrorDetails(lastErr);
  logger.error({ error: lastErr, opName }, `${opName} failed after retries`);
  throw new AppError(502, 'Payment gateway error', 'GATEWAY_ERROR', {
    operation: opName,
    originalError: details.description,
  });
}
