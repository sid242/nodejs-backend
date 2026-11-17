import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { db as primaryDb, type Database } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { createRedis, redis } from '@/config/redis';
import * as schema from '@/db/schema/index';
import { AppError } from '@/lib/errors';
import { getSecretStore } from '@/lib/secrets';

export interface DedicatedPoolEntry {
  client: ReturnType<typeof postgres>;
  drizzle: Database;
  lastUsedAt: Date;
}

export interface TenantRoutingContext {
  id: string;
  databaseMode?: 'shared' | 'dedicated' | string;
  databaseKey?: string;
  databaseSecretRef?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type TenantRoutingInput = string | TenantRoutingContext;

export interface TenantDbHealthResult {
  healthy: boolean;
  databaseMode: 'shared' | 'dedicated' | string;
  databaseKey?: string;
  databaseName?: string;
  latencyMs: number;
  error?: string;
}

export interface DedicatedPoolStats {
  activePools: number;
  maxPools: number;
  pools: Array<{
    key: string;
    lastUsedAt: Date;
    idleSeconds: number;
  }>;
}

// Bounded dedicated connection pools cache
const dedicatedPools = new Map<string, DedicatedPoolEntry>();
const MAX_DEDICATED_POOLS = env.DEDICATED_POOL_MAX_TENANTS;
let maxDedicatedPoolsLimit = MAX_DEDICATED_POOLS;
const DEDICATED_POOL_SIZE = env.DEDICATED_POOL_SIZE;

/**
 * Returns a Drizzle database instance for the specified tenant context.
 * - Standard tenants (shared mode): routes to primary shared PostgreSQL cluster with tenant scoping.
 * - Enterprise tenants (dedicated mode): routes to an isolated, dedicated database connection pool.
 *
 * Accepts either a string `tenantId` (which resolves the tenant registry record)
 * or a pre-resolved `TenantRoutingContext`.
 */
export async function getTenantDb(tenantOrId?: TenantRoutingInput): Promise<Database> {
  if (!tenantOrId) {
    return primaryDb;
  }

  let tenant: TenantRoutingContext | null = null;
  if (typeof tenantOrId === 'string') {
    const [record] = await primaryDb
      .select({
        id: schema.tenants.id,
        databaseMode: schema.tenants.databaseMode,
        databaseKey: schema.tenants.databaseKey,
        databaseSecretRef: schema.tenants.databaseSecretRef,
        metadata: schema.tenants.metadata,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantOrId))
      .limit(1);

    if (!record) {
      return primaryDb;
    }
    tenant = record as TenantRoutingContext;
  } else {
    tenant = tenantOrId;
  }

  if (tenant.databaseMode !== 'dedicated' || !tenant.databaseKey) {
    return primaryDb;
  }

  const poolKey = tenant.databaseKey;
  const existing = dedicatedPools.get(poolKey);
  if (existing) {
    existing.lastUsedAt = new Date();
    return existing.drizzle;
  }

  // Evict oldest pool if cache reaches budget limit
  if (dedicatedPools.size >= maxDedicatedPoolsLimit) {
    const oldestKey = [...dedicatedPools.entries()].sort(
      (a, b) => a[1].lastUsedAt.getTime() - b[1].lastUsedAt.getTime(),
    )[0]?.[0];
    if (oldestKey) {
      const entry = dedicatedPools.get(oldestKey);
      if (entry) {
        await entry.client
          .end({ timeout: 5 })
          .catch((err: unknown) => logger.warn({ err }, 'Error closing evicted dedicated pool'));
        dedicatedPools.delete(oldestKey);
      }
    }
  }

  try {
    const metadata = tenant.metadata as Record<string, unknown> | null | undefined;
    const dedicatedDbName =
      (metadata?.databaseName as string) ||
      `tenant_${tenant.id.replace(/-/g, '_')}`;

    let baseConnectionUrl: string | null = null;
    if (tenant.databaseSecretRef) {
      const secretStore = getSecretStore();
      baseConnectionUrl = await secretStore.get(tenant.databaseSecretRef);
    }

    if (!baseConnectionUrl) {
      baseConnectionUrl = (metadata?.connectionUrl as string) || env.DATABASE_URL;
    }

    // In production, credentials would be resolved from AWS Secrets Manager using tenant.databaseSecretRef.
    const dedicatedClient = postgres(baseConnectionUrl, {
      database: dedicatedDbName,
      max: DEDICATED_POOL_SIZE,
      idle_timeout: 30,
      connect_timeout: 5,
    });

    const dedicatedDrizzle = drizzle({ client: dedicatedClient, schema }) as unknown as Database;

    // Fast probe to verify database connectivity before caching pool
    await dedicatedClient`SELECT 1`.catch((probeErr) => {
      logger.warn({ probeErr, tenantId: tenant.id }, 'Initial connectivity check to dedicated tenant database failed');
      throw probeErr;
    });

    dedicatedPools.set(poolKey, {
      client: dedicatedClient,
      drizzle: dedicatedDrizzle,
      lastUsedAt: new Date(),
    });

    logger.info(
      { tenantId: tenant.id, poolKey, database: dedicatedDbName },
      'Initialized dedicated database connection pool for enterprise tenant',
    );
    return dedicatedDrizzle;
  } catch (err: unknown) {
    logger.error(
      { err, tenantId: tenant.id },
      'Failed to initialize or connect to dedicated tenant database',
    );
    // Explicit 503 Service Unavailable — NEVER fall back to primary shared database for dedicated tenants
    throw AppError.serviceUnavailable(
      'The dedicated database for this workspace is currently unavailable. Please try again shortly.',
      {
        code: 'TENANT_DB_UNAVAILABLE',
        tenantId: tenant.id,
      },
    );
  }
}

/**
 * Checks connectivity and latency to the tenant's assigned database (shared or dedicated).
 */
export async function checkTenantDbHealth(
  tenantOrId?: TenantRoutingInput,
): Promise<TenantDbHealthResult> {
  const startTime = Date.now();
  try {
    const targetDb = await getTenantDb(tenantOrId);
    await targetDb.execute(sql`SELECT 1 as ping`);
    const latencyMs = Date.now() - startTime;

    let mode = 'shared';
    let key = 'primary';
    let dbName: string | undefined;

    if (typeof tenantOrId === 'string') {
      const [record] = await primaryDb
        .select({
          databaseMode: schema.tenants.databaseMode,
          databaseKey: schema.tenants.databaseKey,
          metadata: schema.tenants.metadata,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantOrId))
        .limit(1);
      if (record) {
        mode = record.databaseMode;
        key = record.databaseKey;
        dbName = (record.metadata as Record<string, unknown> | null)?.databaseName as string | undefined;
      }
    } else if (tenantOrId) {
      mode = tenantOrId.databaseMode ?? 'shared';
      key = tenantOrId.databaseKey ?? 'primary';
      dbName = (tenantOrId.metadata as Record<string, unknown> | null)?.databaseName as string | undefined;
    }

    return {
      healthy: true,
      databaseMode: mode,
      databaseKey: key,
      databaseName: dbName,
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    return {
      healthy: false,
      databaseMode:
        typeof tenantOrId === 'object' && tenantOrId?.databaseMode
          ? tenantOrId.databaseMode
          : 'unknown',
      latencyMs,
      error: (err as Error)?.message ?? 'Database connection failed',
    };
  }
}

/**
 * Returns current metrics and connection stats for dedicated pools.
 */
export function getDedicatedPoolStats(): DedicatedPoolStats {
  const now = Date.now();
  const pools = [...dedicatedPools.entries()].map(([key, entry]) => ({
    key,
    lastUsedAt: entry.lastUsedAt,
    idleSeconds: Math.floor((now - entry.lastUsedAt.getTime()) / 1000),
  }));

  return {
    activePools: dedicatedPools.size,
    maxPools: maxDedicatedPoolsLimit,
    pools,
  };
}

const INVALIDATION_CHANNEL = 'tenant-db:invalidate';
let subscriberClient: ReturnType<typeof createRedis> | null = null;

/**
 * Publishes an invalidation event across the cluster to evict a tenant database pool on all API replicas.
 */
export async function publishTenantDbInvalidation(
  databaseKey: string,
  tenantId?: string,
): Promise<void> {
  try {
    await redis.publish(INVALIDATION_CHANNEL, JSON.stringify({ databaseKey, tenantId }));
  } catch (err) {
    logger.warn({ err, databaseKey }, 'Failed to publish tenant-db invalidation');
  }
}

/**
 * Subscribes to cluster-wide database pool invalidation notifications via Redis pub/sub.
 */
export function initTenantDbInvalidationSubscriber(): void {
  if (subscriberClient) return;
  if (process.env.NODE_ENV === 'test') return;
  try {
    subscriberClient = createRedis('tenant-db-sub');
    subscriberClient.subscribe(INVALIDATION_CHANNEL, (err) => {
      if (err) {
        logger.error({ err }, 'Failed to subscribe to tenant-db:invalidate channel');
      }
    });
    subscriberClient.on('message', async (channel, message) => {
      if (channel === INVALIDATION_CHANNEL) {
        try {
          const { databaseKey } = JSON.parse(message);
          if (databaseKey) {
            await closeDedicatedPool(databaseKey, false);
          }
        } catch {
          // Ignore malformed message
        }
      }
    });
  } catch (err) {
    logger.error({ err }, 'Failed to initialize tenant db invalidation subscriber');
  }
}

/**
 * Closes and evicts a specific dedicated database pool from cache.
 * If broadcast is true, notifies all other cluster instances via Redis pub/sub.
 */
export async function closeDedicatedPool(
  poolKey: string,
  broadcast = true,
): Promise<boolean> {
  const entry = dedicatedPools.get(poolKey);
  if (entry) {
    try {
      await entry.client.end({ timeout: 5 });
    } catch (err: unknown) {
      logger.warn({ err, poolKey }, 'Error closing dedicated pool');
    }
    dedicatedPools.delete(poolKey);
  }

  if (broadcast) {
    await publishTenantDbInvalidation(poolKey);
  }

  return Boolean(entry);
}

/**
 * Allows adjusting pool limit for testing LRU eviction.
 */
export function setMaxDedicatedPoolsForTesting(limit: number): void {
  maxDedicatedPoolsLimit = limit;
}

/**
 * Resets pool limit back to default MAX_DEDICATED_POOLS.
 */
export function resetMaxDedicatedPoolsForTesting(): void {
  maxDedicatedPoolsLimit = MAX_DEDICATED_POOLS;
}

/** Gracefully drain all dedicated connection pools upon server shutdown. */
export async function drainDedicatedPools(): Promise<void> {
  if (subscriberClient) {
    subscriberClient.disconnect();
    subscriberClient = null;
  }
  const promises = [...dedicatedPools.values()].map((entry) =>
    entry.client.end({ timeout: 5 }).catch(() => {}),
  );
  await Promise.all(promises);
  dedicatedPools.clear();
}
