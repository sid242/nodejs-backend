import crypto from 'node:crypto';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { logger } from '@/config/logger';
import { webhookDeliveries, webhookEndpoints } from '@/db/schema/developers/webhooks';
import { decrypt } from '@/lib/crypto';
import { assertSafeWebhookUrl } from '@/lib/ssrf';

export interface WebhookDeliveryJobData {
  deliveryId: string;
  endpointId: string;
  tenantId: string;
  url: string;
  secretEncrypted: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempt: number;
}

export async function processWebhookDelivery(job: Job<WebhookDeliveryJobData>): Promise<void> {
  const { deliveryId, endpointId, url, secretEncrypted, eventId, eventType, payload, attempt } =
    job.data;

  const startTime = Date.now();
  let secret = '';
  try {
    secret = decrypt(secretEncrypted);
  } catch (decErr) {
    logger.error({ err: decErr, endpointId }, 'Failed to decrypt webhook endpoint signing secret');
    throw new Error('Signing secret decryption failed');
  }

  // 1. SSRF Safety Verification
  try {
    await assertSafeWebhookUrl(url, { allowLocalhostInDev: true });
  } catch (ssrfErr: any) {
    const errorSnippet = `SSRF Check Blocked: ${ssrfErr?.message ?? 'Disallowed target'}`;
    await db
      .update(webhookDeliveries)
      .set({
        status: 'FAILED',
        responseBodySnippet: errorSnippet,
        durationMs: Date.now() - startTime,
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    logger.warn({ endpointId, url, err: ssrfErr }, 'Webhook delivery blocked by SSRF filter');
    return;
  }

  // 2. Prepare payload and HMAC signature
  const timestamp = Math.floor(Date.now() / 1000);
  const payloadString = JSON.stringify({
    id: eventId,
    event: eventType,
    createdAt: new Date().toISOString(),
    data: payload,
  });

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payloadString}`)
    .digest('hex');

  // 3. Dispatch HTTP request with 10s timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  let responseStatus: number | null = null;
  let responseSnippet: string | null = null;
  let isSuccess = false;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Foundation-Webhook-Worker/1.0',
        'X-Webhook-Id': deliveryId,
        'X-Webhook-Event': eventType,
        'X-Webhook-Timestamp': String(timestamp),
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body: payloadString,
      signal: controller.signal,
    });

    responseStatus = response.status;
    const text = await response.text().catch(() => '');
    responseSnippet = text.slice(0, 500); // Record up to 500 chars

    isSuccess = response.ok;
  } catch (netErr: any) {
    responseSnippet =
      netErr?.name === 'AbortError'
        ? 'Request timed out (10s)'
        : String(netErr?.message ?? 'Network error');
    isSuccess = false;
  } finally {
    clearTimeout(timeoutId);
  }

  const durationMs = Date.now() - startTime;

  // 4. Update delivery status
  await db
    .update(webhookDeliveries)
    .set({
      status: isSuccess ? 'SUCCESS' : 'FAILED',
      responseStatus,
      responseBodySnippet: responseSnippet,
      durationMs,
      attempt,
      updatedAt: new Date(),
    })
    .where(eq(webhookDeliveries.id, deliveryId));

  if (!isSuccess) {
    // If reached 5 attempts, mark endpoint status as FAILING
    if (attempt >= 5) {
      await db
        .update(webhookEndpoints)
        .set({ status: 'FAILING', updatedAt: new Date() })
        .where(eq(webhookEndpoints.id, endpointId));

      logger.warn({ endpointId, url }, 'Webhook endpoint marked FAILING after max attempts');
    }

    throw new Error(
      `Webhook delivery failed with HTTP ${responseStatus ?? 'ERR'}: ${responseSnippet ?? 'Unknown'}`,
    );
  }
}
