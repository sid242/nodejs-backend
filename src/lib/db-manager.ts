import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { db as primaryDb, type Database } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import * as schema from '@/db/schema/index';
import { AppError } from '@/lib/errors';

interface DedicatedPoolEntry {
  client: ReturnType<typeof postgres>;
  drizzle: Database;
  lastUsedAt: Date;
}

// Bounded dedicated connection pools cache
const dedicatedPools = new Map<string, DedicatedPoolEntry>();
const MAX_DEDICATED_POOLS = 20;

/**
 * Returns a Drizzle database instance for the specified tenant context.
 * - Standard tenants (shared mode): routes to primary shared PostgreSQL cluster with tenant scoping.
 * - Enterprise tenants (dedicated mode): routes to an isolated, dedicated database connection pool.
 */
export async function getTenantDb(tenant?: {
  id: string;
  databaseMode?: 'shared' | 'dedicated' | string;
  databaseKey?: string;
  databaseSecretRef?: string | null;
}): Promise<Database> {
  if (!tenant || tenant.databaseMode !== 'dedicated' || !tenant.databaseKey) {
    return primaryDb;
  }

  const poolKey = tenant.databaseKey;
  const existing = dedicatedPools.get(poolKey);
  if (existing) {
    existing.lastUsedAt = new Date();
    return existing.drizzle;
  }

  // Evict oldest pool if cache reaches budget limit
  if (dedicatedPools.size >= MAX_DEDICATED_POOLS) {
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
    // In production, credentials would be resolved from AWS Secrets Manager using tenant.databaseSecretRef.
    const dedicatedDbName = `tenant_${tenant.id.replace(/-/g, '_')}`;
    const dedicatedClient = postgres(env.DATABASE_URL, {
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
      { tenantId: tenant.id, poolKey },
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

/** Gracefully drain all dedicated connection pools upon server shutdown. */
export async function drainDedicatedPools(): Promise<void> {
  const promises = [...dedicatedPools.values()].map((entry) =>
    entry.client.end({ timeout: 5 }).catch(() => {}),
  );
  await Promise.all(promises);
  dedicatedPools.clear();
}
