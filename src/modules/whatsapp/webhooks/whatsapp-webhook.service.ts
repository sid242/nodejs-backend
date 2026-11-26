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

export interface WebhookRoutingDependencies {
  resolveTenantByPhoneNumberId: typeof accountRepo.resolveTenantByPhoneNumberId;
  resolveTenantByWabaId: typeof accountRepo.resolveTenantByWabaId;
}

export const defaultWebhookRoutingDeps: WebhookRoutingDependencies = {
  resolveTenantByPhoneNumberId: accountRepo.resolveTenantByPhoneNumberId,
  resolveTenantByWabaId: accountRepo.resolveTenantByWabaId,
};

export async function processWebhookPayload(
  rawBody?: Buffer,
  signature?: string | string[],
  payload?: Record<string, unknown>,
  deps: WebhookRoutingDependencies = defaultWebhookRoutingDeps,
): Promise<{ status: string }> {
  // 1. Mandatory HMAC SHA-256 Signature Verification
  assertValidMetaSignature(signature, rawBody);

  if (!payload || !rawBody) {
    throw AppError.badRequest('Empty or invalid webhook payload');
  }

  // 2. Event Deduplication check via Redis Fingerprint (W3: do NOT set key before successful enqueue)
  const fingerprint = crypto.createHash('sha256').update(rawBody).digest('hex');
  const dedupeKey = `whatsapp:webhook:dedupe:${fingerprint}`;
  const alreadyProcessed = await redis.get(dedupeKey);

  if (alreadyProcessed) {
    logger.info({ fingerprint }, 'Duplicate webhook event received; safely ignoring');
    return { status: 'duplicate_ignored' };
  }

  // 3. Extract and route PER CHANGE (W1: batched payloads are routed per entry and change)
  const entries = (payload.entry as Array<Record<string, unknown>>) ?? [];
  const jobsToEnqueue: Array<{
    name: string;
    data: {
      tenantId: string;
      wabaId: string;
      phoneNumberId?: string;
      payload: Record<string, unknown>;
      routingKey?: string | null;
    };
    opts: {
      jobId: string;
      removeOnComplete: boolean;
      attempts: number;
      backoff: { type: 'exponential'; delay: number };
    };
  }> = [];

  let entryIndex = 0;
  for (const entry of entries) {
    const wabaId = String(entry.id ?? '');
    const changes = (entry.changes as Array<Record<string, unknown>>) ?? [];

    let changeIndex = 0;
    for (const change of changes) {
      const val = change.value as Record<string, unknown> | undefined;
      const meta = val?.metadata as Record<string, unknown> | undefined;
      const phoneNumberId = meta?.phone_number_id ? String(meta.phone_number_id) : undefined;

      // Resolve tenant routing per change:
      // First try by phone_number_id, if missing or not resolved, try by wabaId
      let routing:
        | {
            tenantId: string;
            wabaId: string;
            connectionStatus: string;
            databaseRoutingKey?: string | null;
          }
        | undefined;

      if (phoneNumberId) {
        routing = await deps.resolveTenantByPhoneNumberId(phoneNumberId);
      }
      if (!routing && wabaId) {
        routing = await deps.resolveTenantByWabaId(wabaId);
      }

      if (!routing) {
        logger.warn(
          { phoneNumberId, wabaId, changeField: change.field },
          'Unregistered WhatsApp asset received webhook change; skipping change',
        );
        changeIndex++;
        continue;
      }

      // Enqueue job with ONLY this entry and this change
      const changePayload = {
        object: payload.object ?? 'whatsapp_business_account',
        entry: [
          {
            id: wabaId,
            changes: [change],
          },
        ],
      };

      jobsToEnqueue.push({
        name: 'process-whatsapp-webhook',
        data: {
          tenantId: routing.tenantId,
          wabaId: routing.wabaId || wabaId,
          phoneNumberId,
          payload: changePayload,
          routingKey: routing.databaseRoutingKey,
        },
        opts: {
          jobId: `${fingerprint}:${entryIndex}:${changeIndex}`,
          removeOnComplete: true,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      });

      changeIndex++;
    }
    entryIndex++;
  }

  if (jobsToEnqueue.length === 0) {
    logger.info('Webhook event contained no resolvable changes; acknowledging');
    return { status: 'ignored_no_routable_changes' };
  }

  // 4. Safely enqueue all jobs; on failure throw 500 so Meta retries
  try {
    await whatsAppWebhookQueue.addBulk(jobsToEnqueue);
    // 5. Mark deduplication in Redis ONLY AFTER successful enqueue!
    await redis.set(dedupeKey, '1', 'EX', 86400);
  } catch (queueErr) {
    logger.error({ queueErr, fingerprint }, 'Failed to enqueue WhatsApp webhook jobs');
    throw AppError.internal('Failed to queue webhook event for processing', {
      code: 'WHATSAPP_QUEUE_ERROR',
      cause: queueErr,
    });
  }

  return { status: 'queued' };
}
