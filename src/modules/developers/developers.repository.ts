import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import type { DbExecutor } from '@/config/db';
import {
  apiKeys,
  webhookDeliveries,
  webhookEndpoints,
  type ApiKeyRecord,
  type NewApiKeyRecord,
  type NewWebhookDeliveryRecord,
  type NewWebhookEndpointRecord,
  type WebhookDeliveryRecord,
  type WebhookEndpointRecord,
} from '@/db/schema/index';
import { assertTenantScope, tenantDb } from '@/db/tenancy/context';

export const publicApiKey = {
  id: apiKeys.id,
  tenantId: apiKeys.tenantId,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  scopes: apiKeys.scopes,
  createdByMemberId: apiKeys.createdByMemberId,
  lastUsedAt: apiKeys.lastUsedAt,
  lastUsedIp: apiKeys.lastUsedIp,
  expiresAt: apiKeys.expiresAt,
  revokedAt: apiKeys.revokedAt,
  rateLimitPerMin: apiKeys.rateLimitPerMin,
  allowedIps: apiKeys.allowedIps,
  createdAt: apiKeys.createdAt,
  updatedAt: apiKeys.updatedAt,
};

export type PublicApiKey = typeof publicApiKey;

// ─── API Keys ─────────────────────────────────────────────────────────────

export async function createApiKey(
  data: NewApiKeyRecord,
  executor: DbExecutor = tenantDb(),
): Promise<ApiKeyRecord> {
  assertTenantScope(data.tenantId);
  const [created] = await executor.insert(apiKeys).values(data).returning();
  if (!created) throw new Error('Failed to create API key');
  return created;
}

export async function findApiKeyById(
  tenantId: string,
  keyId: string,
  executor: DbExecutor = tenantDb(),
): Promise<ApiKeyRecord | null> {
  assertTenantScope(tenantId);
  const [key] = await executor
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, keyId)))
    .limit(1);
  return key ?? null;
}

export async function findApiKeyByKeyHash(
  keyHash: string,
  executor: DbExecutor = tenantDb(),
): Promise<ApiKeyRecord | null> {
  const [key] = await executor
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);
  return key ?? null;
}

export async function listApiKeys(
  tenantId: string,
  filter: { status?: 'active' | 'revoked' | 'expired' | 'all'; page: number; limit: number },
  executor: DbExecutor = tenantDb(),
): Promise<{ items: ApiKeyRecord[]; total: number; page: number; limit: number }> {
  assertTenantScope(tenantId);

  const conditions = [eq(apiKeys.tenantId, tenantId)];
  const now = new Date();

  if (filter.status === 'active') {
    conditions.push(isNull(apiKeys.revokedAt));
  } else if (filter.status === 'revoked') {
    conditions.push(isNotNull(apiKeys.revokedAt));
  }

  const offset = (filter.page - 1) * filter.limit;

  const [items, countResult] = await Promise.all([
    executor
      .select()
      .from(apiKeys)
      .where(and(...conditions))
      .orderBy(desc(apiKeys.createdAt))
      .limit(filter.limit)
      .offset(offset),
    executor
      .select({ count: sql<number>`count(*)::int` })
      .from(apiKeys)
      .where(and(...conditions)),
  ]);

  return {
    items,
    total: countResult[0]?.count ?? 0,
    page: filter.page,
    limit: filter.limit,
  };
}

export async function revokeApiKey(
  tenantId: string,
  keyId: string,
  executor: DbExecutor = tenantDb(),
): Promise<ApiKeyRecord | null> {
  assertTenantScope(tenantId);
  const [revoked] = await executor
    .update(apiKeys)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, keyId)))
    .returning();
  return revoked ?? null;
}

export async function updateApiKeyUsage(
  keyId: string,
  ip: string,
  executor: DbExecutor = tenantDb(),
): Promise<void> {
  await executor
    .update(apiKeys)
    .set({ lastUsedAt: new Date(), lastUsedIp: ip, updatedAt: new Date() })
    .where(eq(apiKeys.id, keyId));
}

export async function countActiveApiKeys(
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<number> {
  assertTenantScope(tenantId);
  const [result] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(and(eq(apiKeys.tenantId, tenantId), isNull(apiKeys.revokedAt)));
  return result?.count ?? 0;
}

// ─── Webhooks ─────────────────────────────────────────────────────────────

export async function createWebhookEndpoint(
  data: NewWebhookEndpointRecord,
  executor: DbExecutor = tenantDb(),
): Promise<WebhookEndpointRecord> {
  assertTenantScope(data.tenantId);
  const [created] = await executor.insert(webhookEndpoints).values(data).returning();
  if (!created) throw new Error('Failed to create webhook endpoint');
  return created;
}

export async function findWebhookEndpointById(
  tenantId: string,
  endpointId: string,
  executor: DbExecutor = tenantDb(),
): Promise<WebhookEndpointRecord | null> {
  assertTenantScope(tenantId);
  const [endpoint] = await executor
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId)))
    .limit(1);
  return endpoint ?? null;
}

export async function listWebhookEndpoints(
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<WebhookEndpointRecord[]> {
  assertTenantScope(tenantId);
  return executor
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.tenantId, tenantId))
    .orderBy(desc(webhookEndpoints.createdAt));
}

export async function updateWebhookEndpoint(
  tenantId: string,
  endpointId: string,
  data: Partial<NewWebhookEndpointRecord>,
  executor: DbExecutor = tenantDb(),
): Promise<WebhookEndpointRecord | null> {
  assertTenantScope(tenantId);
  const [updated] = await executor
    .update(webhookEndpoints)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId)))
    .returning();
  return updated ?? null;
}

export async function deleteWebhookEndpoint(
  tenantId: string,
  endpointId: string,
  executor: DbExecutor = tenantDb(),
): Promise<boolean> {
  assertTenantScope(tenantId);
  const result = await executor
    .delete(webhookEndpoints)
    .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId)))
    .returning({ id: webhookEndpoints.id });
  return result.length > 0;
}

export async function findActiveEndpointsForEvent(
  tenantId: string,
  eventType: string,
  executor: DbExecutor = tenantDb(),
): Promise<WebhookEndpointRecord[]> {
  assertTenantScope(tenantId);
  const endpoints = await executor
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.status, 'ACTIVE')));

  return endpoints.filter((ep) => ep.events?.includes(eventType) || ep.events?.includes('*'));
}

// ─── Webhook Deliveries ────────────────────────────────────────────────────

export async function createWebhookDelivery(
  data: NewWebhookDeliveryRecord,
  executor: DbExecutor = tenantDb(),
): Promise<WebhookDeliveryRecord> {
  assertTenantScope(data.tenantId);
  const [created] = await executor.insert(webhookDeliveries).values(data).returning();
  if (!created) throw new Error('Failed to create webhook delivery record');
  return created;
}

export async function listWebhookDeliveries(
  tenantId: string,
  endpointId: string,
  filter: { status?: 'PENDING' | 'SUCCESS' | 'FAILED' | 'all'; page: number; limit: number },
  executor: DbExecutor = tenantDb(),
): Promise<{ items: WebhookDeliveryRecord[]; total: number; page: number; limit: number }> {
  assertTenantScope(tenantId);

  const conditions = [
    eq(webhookDeliveries.tenantId, tenantId),
    eq(webhookDeliveries.endpointId, endpointId),
  ];

  if (filter.status && filter.status !== 'all') {
    conditions.push(eq(webhookDeliveries.status, filter.status));
  }

  const offset = (filter.page - 1) * filter.limit;

  const [items, countResult] = await Promise.all([
    executor
      .select()
      .from(webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(filter.limit)
      .offset(offset),
    executor
      .select({ count: sql<number>`count(*)::int` })
      .from(webhookDeliveries)
      .where(and(...conditions)),
  ]);

  return {
    items,
    total: countResult[0]?.count ?? 0,
    page: filter.page,
    limit: filter.limit,
  };
}

export async function findWebhookDeliveryById(
  tenantId: string,
  endpointId: string,
  deliveryId: string,
  executor: DbExecutor = tenantDb(),
): Promise<WebhookDeliveryRecord | null> {
  assertTenantScope(tenantId);
  const [delivery] = await executor
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.tenantId, tenantId),
        eq(webhookDeliveries.endpointId, endpointId),
        eq(webhookDeliveries.id, deliveryId),
      ),
    )
    .limit(1);
  return delivery ?? null;
}
