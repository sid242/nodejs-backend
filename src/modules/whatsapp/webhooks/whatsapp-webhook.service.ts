import crypto from 'node:crypto';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { redis } from '@/config/redis';
import { AppError } from '@/lib/errors';
import { whatsAppWebhookQueue } from '@/queues/index';

import * as accountRepo from '../repositories/whatsapp-account.repository';
import { assertValidMetaSignature } from './whatsapp-signature.service';

export function verifySubscription(mode?: string, token?: string, challenge?: string): string {
  const expectedToken = env.META_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expectedToken && challenge) {
    logger.info('Meta webhook subscription verified successfully');
    return challenge;
  }

  throw AppError.forbidden('Invalid Meta webhook verification handshake');
}

export async function processWebhookPayload(
  rawBody?: Buffer,
  signature?: string | string[],
  payload?: Record<string, unknown>,
): Promise<{ status: string }> {
  // 1. Mandatory HMAC SHA-256 Signature Verification
  assertValidMetaSignature(signature, rawBody);

  if (!payload || !rawBody) {
    throw AppError.badRequest('Empty or invalid webhook payload');
  }

  // 2. Event Deduplication via Redis Fingerprint
  const fingerprint = crypto.createHash('sha256').update(rawBody).digest('hex');
  const dedupeKey = `whatsapp:webhook:dedupe:${fingerprint}`;
  const isDuplicate = await redis.set(dedupeKey, '1', 'EX', 86400, 'NX');

  if (!isDuplicate) {
    logger.info({ fingerprint }, 'Duplicate webhook event received; safely ignoring');
    return { status: 'duplicate_ignored' };
  }

  // 3. Extract WhatsApp Phone Number ID from Meta payload
  const entries = (payload.entry as Array<Record<string, unknown>>) ?? [];
  let phoneNumberId: string | undefined;

  for (const entry of entries) {
    const changes = (entry.changes as Array<Record<string, unknown>>) ?? [];
    for (const change of changes) {
      const val = change.value as Record<string, unknown> | undefined;
      const meta = val?.metadata as Record<string, unknown> | undefined;
      if (meta?.phone_number_id) {
        phoneNumberId = String(meta.phone_number_id);
        break;
      }
    }
    if (phoneNumberId) break;
  }

  if (!phoneNumberId) {
    logger.info('Webhook event does not contain a phone_number_id; acknowledging');
    return { status: 'ignored_no_phone_number' };
  }

  // 4. Central Platform Registry Lookup (Primary DB -> Tenant & Database routing)
  const routing = await accountRepo.resolveTenantByPhoneNumberId(phoneNumberId);
  if (!routing) {
    logger.warn({ phoneNumberId }, 'Unregistered WhatsApp phone number received webhook');
    return { status: 'unregistered_phone_number' };
  }

  // 5. Enqueue to durable BullMQ queue for async processing
  await whatsAppWebhookQueue.add(
    'process-whatsapp-webhook',
    {
      tenantId: routing.tenantId,
      wabaId: routing.wabaId,
      phoneNumberId,
      payload,
      routingKey: routing.databaseRoutingKey,
    },
    {
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    },
  );

  return { status: 'queued' };
}
