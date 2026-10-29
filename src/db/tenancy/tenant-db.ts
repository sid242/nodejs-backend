import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { db as primaryDb, type Database } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import * as schema from '@/db/schema/index';
import { AppError } from '@/lib/errors';

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
const MAX_DEDICATED_POOLS = 20;
let maxDedicatedPoolsLimit = MAX_DEDICATED_POOLS;

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
    const baseConnectionUrl = (metadata?.connectionUrl as string) || env.DATABASE_URL;

    // In production, credentials would be resolved from AWS Secrets Manager using tenant.databaseSecretRef.
    const dedicatedClient = postgres(baseConnectionUrl, {
      database: dedicatedDbName,
      max: Math.min(env.DB_POOL_MAX, 5),
      idle_timeout: 30,
      connect_timeout: 5,
    });

    const dedicatedDrizzle = drizzle({ client: dedicatedClient, schema }) as unknown as Database;
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
      'Failed to initialize dedicated database connection',
    );
    throw AppError.internal('Unable to establish connection to dedicated tenant database');
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

/**
 * Closes and evicts a specific dedicated database pool from cache.
 */
export async function closeDedicatedPool(poolKey: string): Promise<boolean> {
  const entry = dedicatedPools.get(poolKey);
  if (!entry) return false;
  try {
    await entry.client.end({ timeout: 5 });
  } catch (err: unknown) {
    logger.warn({ err, poolKey }, 'Error closing dedicated pool');
  }
  dedicatedPools.delete(poolKey);
  return true;
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
  const promises = [...dedicatedPools.values()].map((entry) =>
    entry.client.end({ timeout: 5 }).catch(() => {}),
  );
  await Promise.all(promises);
  dedicatedPools.clear();
}
