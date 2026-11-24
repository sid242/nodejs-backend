import crypto from 'node:crypto';

import { encrypt } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { assertSafeWebhookUrl } from '@/lib/ssrf';
import * as auditService from '@/modules/audit/audit.service';
import { webhookQueue } from '@/queues/index';

import type {
  CreateApiKeyDto,
  CreateWebhookEndpointDto,
  ListApiKeysQueryDto,
  ListDeliveriesQueryDto,
  UpdateWebhookEndpointDto,
} from './developers.dto';
import * as repo from './developers.repository';

// ─── API Keys Services ──────────────────────────────────────────────────────

export async function createApiKey(
  tenantId: string,
  actorMemberId: string | undefined,
  dto: CreateApiKeyDto,
) {
  // Key format: sk_live_<prefix8>_<random32>
  const prefix = crypto.randomBytes(4).toString('hex');
  const randomSuffix = crypto.randomBytes(16).toString('hex');
  const rawKey = `sk_live_${prefix}_${randomSuffix}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const expiresInDays = dto.expiresInDays ?? 90;
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 3600 * 1000);

  const created = await repo.createApiKey({
    tenantId,
    name: dto.name,
    prefix,
    keyHash,
    scopes: dto.scopes,
    createdByMemberId: actorMemberId,
    expiresAt,
    rateLimitPerMin: dto.rateLimitPerMin ?? 60,
    allowedIps: dto.allowedIps ?? [],
  });

  await auditService.logSecurityEvent({
    tenantId,
    userId: actorMemberId,
    action: 'API_KEY.CREATED',
    entityType: 'ApiKey',
    entityId: created.id,
    metadata: { name: created.name, prefix: created.prefix, scopes: created.scopes },
  });

  return {
    apiKey: created,
    rawKey, // Only shown once at creation!
    message:
      'API key generated successfully. Save this secret key now as you will not be able to view it again.',
  };
}

export async function listApiKeys(tenantId: string, query: ListApiKeysQueryDto) {
  return repo.listApiKeys(tenantId, {
    status: query?.status,
    page: query?.page ?? 1,
    limit: query?.limit ?? 20,
  });
}

export async function getApiKey(tenantId: string, keyId: string) {
  const key = await repo.findApiKeyById(tenantId, keyId);
  if (!key) throw AppError.notFound('API key not found');
  return key;
}

export async function revokeApiKey(tenantId: string, keyId: string, actorMemberId?: string) {
  const revoked = await repo.revokeApiKey(tenantId, keyId);
  if (!revoked) throw AppError.notFound('API key not found');

  await auditService.logSecurityEvent({
    tenantId,
    userId: actorMemberId,
    action: 'API_KEY.REVOKED',
    entityType: 'ApiKey',
    entityId: revoked.id,
    metadata: { name: revoked.name, prefix: revoked.prefix },
  });

  return revoked;
}

export async function rotateApiKey(tenantId: string, keyId: string, actorMemberId?: string) {
  const oldKey = await repo.findApiKeyById(tenantId, keyId);
  if (!oldKey) throw AppError.notFound('API key not found');

  await repo.revokeApiKey(tenantId, keyId);

  const prefix = crypto.randomBytes(4).toString('hex');
  const randomSuffix = crypto.randomBytes(16).toString('hex');
  const rawKey = `sk_live_${prefix}_${randomSuffix}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const created = await repo.createApiKey({
    tenantId,
    name: `${oldKey.name} (Rotated)`,
    prefix,
    keyHash,
    scopes: oldKey.scopes,
    createdByMemberId: actorMemberId,
    expiresAt: oldKey.expiresAt,
    rateLimitPerMin: oldKey.rateLimitPerMin,
    allowedIps: oldKey.allowedIps,
  });

  await auditService.logSecurityEvent({
    tenantId,
    userId: actorMemberId,
    action: 'API_KEY.ROTATED',
    entityType: 'ApiKey',
    entityId: created.id,
    metadata: { oldKeyId: oldKey.id, newKeyId: created.id, prefix: created.prefix },
  });

  return {
    apiKey: created,
    rawKey,
    message:
      'API key rotated successfully. Save this secret key now as you will not be able to view it again.',
  };
}

// ─── Outbound Webhook Services ──────────────────────────────────────────────

export async function createWebhookEndpoint(
  tenantId: string,
  actorMemberId: string | undefined,
  dto: CreateWebhookEndpointDto,
) {
  // Enforce HTTPS & SSRF safety check
  await assertSafeWebhookUrl(dto.url, { allowLocalhostInDev: true });

  const rawSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const secretEncrypted = encrypt(rawSecret);

  const created = await repo.createWebhookEndpoint({
    tenantId,
    url: dto.url,
    description: dto.description,
    secretEncrypted,
    events: dto.events,
    status: 'ACTIVE',
    createdByMemberId: actorMemberId,
  });

  await auditService.logSecurityEvent({
    tenantId,
    userId: actorMemberId,
    action: 'WEBHOOK.CREATED',
    entityType: 'WebhookEndpoint',
    entityId: created.id,
    metadata: { url: created.url, events: created.events },
  });

  return {
    endpoint: created,
    signingSecret: rawSecret, // Only shown once at creation!
    message:
      'Webhook endpoint registered successfully. Save your signing secret to verify signatures.',
  };
}

export async function listWebhookEndpoints(tenantId: string) {
  return repo.listWebhookEndpoints(tenantId);
}

export async function getWebhookEndpoint(tenantId: string, endpointId: string) {
  const ep = await repo.findWebhookEndpointById(tenantId, endpointId);
  if (!ep) throw AppError.notFound('Webhook endpoint not found');
  return ep;
}

export async function updateWebhookEndpoint(
  tenantId: string,
  endpointId: string,
  dto: UpdateWebhookEndpointDto,
  actorMemberId?: string,
) {
  if (dto.url) {
    await assertSafeWebhookUrl(dto.url, { allowLocalhostInDev: true });
  }

  const updated = await repo.updateWebhookEndpoint(tenantId, endpointId, dto);
  if (!updated) throw AppError.notFound('Webhook endpoint not found');

  await auditService.logSecurityEvent({
    tenantId,
    userId: actorMemberId,
    action: 'WEBHOOK.UPDATED',
    entityType: 'WebhookEndpoint',
    entityId: updated.id,
    metadata: { url: updated.url, status: updated.status, events: updated.events },
  });

  return updated;
}

export async function deleteWebhookEndpoint(
  tenantId: string,
  endpointId: string,
  actorMemberId?: string,
) {
  const deleted = await repo.deleteWebhookEndpoint(tenantId, endpointId);
  if (!deleted) throw AppError.notFound('Webhook endpoint not found');

  await auditService.logSecurityEvent({
    tenantId,
    userId: actorMemberId,
    action: 'WEBHOOK.DELETED',
    entityType: 'WebhookEndpoint',
    entityId: endpointId,
  });

  return { success: true, message: 'Webhook endpoint deleted successfully' };
}

export async function rotateWebhookSecret(
  tenantId: string,
  endpointId: string,
  actorMemberId?: string,
) {
  const ep = await repo.findWebhookEndpointById(tenantId, endpointId);
  if (!ep) throw AppError.notFound('Webhook endpoint not found');

  const rawSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const secretEncrypted = encrypt(rawSecret);

  const updated = await repo.updateWebhookEndpoint(tenantId, endpointId, { secretEncrypted });
  if (!updated) throw AppError.notFound('Webhook endpoint not found');

  await auditService.logSecurityEvent({
    tenantId,
    userId: actorMemberId,
    action: 'WEBHOOK.SECRET_ROTATED',
    entityType: 'WebhookEndpoint',
    entityId: updated.id,
  });

  return {
    endpoint: updated,
    signingSecret: rawSecret,
    message: 'Webhook signing secret rotated successfully.',
  };
}

export async function listWebhookDeliveries(
  tenantId: string,
  endpointId: string,
  query: ListDeliveriesQueryDto,
) {
  await getWebhookEndpoint(tenantId, endpointId);
  return repo.listWebhookDeliveries(tenantId, endpointId, {
    status: query?.status,
    page: query?.page ?? 1,
    limit: query?.limit ?? 20,
  });
}

export async function redeliverWebhook(tenantId: string, endpointId: string, deliveryId: string) {
  const ep = await getWebhookEndpoint(tenantId, endpointId);
  const delivery = await repo.findWebhookDeliveryById(tenantId, endpointId, deliveryId);
  if (!delivery) throw AppError.notFound('Webhook delivery record not found');

  // Enqueue new job
  await webhookQueue.add(
    'deliver-webhook',
    {
      deliveryId: delivery.id,
      endpointId: ep.id,
      tenantId,
      url: ep.url,
      secretEncrypted: ep.secretEncrypted,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      payload: delivery.payload,
      attempt: (delivery.attempt ?? 1) + 1,
    },
    { jobId: `redeliver-${delivery.id}-${Date.now()}` },
  );

  return { success: true, message: 'Webhook redelivery dispatched to queue' };
}

export async function sendTestEvent(tenantId: string, endpointId: string) {
  const ep = await getWebhookEndpoint(tenantId, endpointId);

  const eventId = `evt_test_${crypto.randomBytes(8).toString('hex')}`;
  const eventType = 'test.ping';
  const payload = {
    message: 'This is a test webhook event from the Foundation platform.',
    timestamp: new Date().toISOString(),
    endpointId,
  };

  const delivery = await repo.createWebhookDelivery({
    endpointId: ep.id,
    tenantId,
    eventId,
    eventType,
    payload,
    status: 'PENDING',
    attempt: 1,
  });

  await webhookQueue.add(
    'deliver-webhook',
    {
      deliveryId: delivery.id,
      endpointId: ep.id,
      tenantId,
      url: ep.url,
      secretEncrypted: ep.secretEncrypted,
      eventId,
      eventType,
      payload,
      attempt: 1,
    },
    { jobId: `test-${delivery.id}-${Date.now()}` },
  );

  return {
    delivery,
    message: 'Test event queued for immediate delivery.',
  };
}

export async function dispatchWebhookEvent(
  tenantId: string,
  eventType: string,
  eventId: string,
  payload: Record<string, unknown>,
) {
  const endpoints = await repo.findActiveEndpointsForEvent(tenantId, eventType);
  if (!endpoints || endpoints.length === 0) return;

  for (const ep of endpoints) {
    const delivery = await repo.createWebhookDelivery({
      endpointId: ep.id,
      tenantId,
      eventId,
      eventType,
      payload,
      status: 'PENDING',
      attempt: 1,
    });

    await webhookQueue.add(
      'deliver-webhook',
      {
        deliveryId: delivery.id,
        endpointId: ep.id,
        tenantId,
        url: ep.url,
        secretEncrypted: ep.secretEncrypted,
        eventId,
        eventType,
        payload,
        attempt: 1,
      },
      { jobId: `webhook-${delivery.id}` },
    );
  }
}
