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
    if (env.NODE_ENV === 'test') {
      return true;
    }
    logger.error('META_APP_SECRET is not configured; rejecting incoming webhook');
    return false;
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
    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    const computedBuf = Buffer.from(computedSignature, 'hex');
    if (expectedBuf.length !== computedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, computedBuf);
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
