import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { type Database } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import * as schema from '@/db/schema';
import { AppError } from '@/lib/errors';

export interface DedicatedDbConfigOptions {
  customDatabaseName?: string;
  customDatabaseKey?: string;
  poolLimit?: number;
  connectionUrl?: string;
}

export interface ProvisionDedicatedDbResult {
  databaseName: string;
  databaseKey: string;
  poolLimit: number;
  schemaVersion: string;
}

/**
 * Validates that database identifier contains only safe SQL identifier characters.
 */
function sanitizeDbIdentifier(name: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!sanitized || !/^[a-z_][a-z0-9_]{1,62}$/.test(sanitized)) {
    throw AppError.badRequest(
      'Invalid database name. Must start with a letter/underscore and contain 2-63 alphanumeric/underscore characters.',
    );
  }
  return sanitized;
}

/**
 * Provisions an isolated enterprise PostgreSQL database for a dedicated tenant:
 * 1. Resolves cluster URL (co-located primary PostgreSQL or custom external connection string).
 * 2. Connects to the cluster administrative root and verifies/creates the database.
 * 3. Connects to the target database and executes pending Drizzle migrations.
 * 4. Returns routing coordinates and connection pool budget.
 */
export async function provisionDedicatedDatabase(
  tenantId: string,
  options?: DedicatedDbConfigOptions,
): Promise<ProvisionDedicatedDbResult> {
  const defaultSanitizedId = tenantId.replace(/-/g, '_');
  const rawDbName = options?.customDatabaseName?.trim() || `tenant_${defaultSanitizedId}`;
  const databaseName = sanitizeDbIdentifier(rawDbName);
  const databaseKey = options?.customDatabaseKey?.trim() || `dedicated-${tenantId}`;
  const poolLimit = options?.poolLimit && options.poolLimit >= 1 && options.poolLimit <= 50 ? options.poolLimit : 5;
  const baseConnectionUrl = options?.connectionUrl?.trim() || env.DATABASE_URL;

  logger.info(
    { tenantId, databaseName, databaseKey, poolLimit, hasCustomUrl: Boolean(options?.connectionUrl) },
    'Initiating dedicated database provisioning',
  );

  // Step 1: Connect to the cluster root database (postgres or default in URL)
  const rootClient = postgres(baseConnectionUrl, { max: 1, idle_timeout: 10 });
  try {
    const existing = await rootClient`
      SELECT 1 FROM pg_database WHERE datname = ${databaseName}
    `;

    if (existing?.length === 0) {
      await rootClient.unsafe(`CREATE DATABASE "${databaseName}"`);
      logger.info({ databaseName }, 'Successfully created dedicated PostgreSQL database');
    } else {
      logger.info({ databaseName }, 'Dedicated PostgreSQL database already exists, proceeding to migrations');
    }
  } catch (err: unknown) {
    logger.error({ err, databaseName }, 'Failed to create dedicated PostgreSQL database');
    throw AppError.internal(
      `Failed to initialize dedicated PostgreSQL database: ${(err as Error)?.message ?? 'Unknown cluster error'}`,
    );
  } finally {
    await rootClient.end({ timeout: 5 }).catch(() => {});
  }

  // Step 2: Connect to the newly created database and execute Drizzle migrations
  const targetUrl = new URL(baseConnectionUrl);
  targetUrl.pathname = `/${databaseName}`;

  const migrationClient = postgres(targetUrl.toString(), { max: 1, idle_timeout: 10 });
  const migrationDb = drizzle({ client: migrationClient, schema }) as unknown as Database;

  try {
    await migrate(migrationDb, { migrationsFolder: './drizzle' });
    logger.info({ databaseName }, 'Successfully executed Drizzle migrations on dedicated database');
  } catch (err: unknown) {
    logger.error({ err, databaseName }, 'Failed to run migrations on dedicated database');
    throw AppError.internal(
      `Failed to apply migrations on dedicated database: ${(err as Error)?.message ?? 'Migration failure'}`,
    );
  } finally {
    await migrationClient.end({ timeout: 5 }).catch(() => {});
  }

  return {
    databaseName,
    databaseKey,
    poolLimit,
    schemaVersion: '1.0.0',
  };
}
