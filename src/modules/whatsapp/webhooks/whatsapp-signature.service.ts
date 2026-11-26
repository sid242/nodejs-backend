import crypto from 'node:crypto';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { AppError } from '@/lib/errors';

export function verifyMetaSignature(
  signatureHeader?: string | string[],
  rawBody?: Buffer,
): boolean {
  const secret = env.META_APP_SECRET;
  if (!secret) {
    logger.warn(
      'META_APP_SECRET is not configured; skipping webhook signature verification in non-production',
    );
    return env.NODE_ENV !== 'production';
  }

  if (!signatureHeader || !rawBody) {
    return false;
  }

  const rawHeader = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!rawHeader || !rawHeader.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = rawHeader.slice('sha256='.length);
  const computedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(computedSignature, 'hex'),
    );
  } catch {
    return false;
  }
}

export function assertValidMetaSignature(
  signatureHeader?: string | string[],
  rawBody?: Buffer,
): void {
  if (!verifyMetaSignature(signatureHeader, rawBody)) {
    throw new AppError(401, 'Invalid Meta webhook signature', 'WHATSAPP_WEBHOOK_SIGNATURE_INVALID');
  }
}
