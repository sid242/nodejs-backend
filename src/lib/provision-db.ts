import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { type Database } from '@/config/db.js';
import { env } from '@/config/env.js';
import { logger } from '@/config/logger.js';
import * as schema from '@/db/schema/index.js';

export interface ProvisionDedicatedDbResult {
  databaseName: string;
  databaseKey: string;
  schemaVersion: string;
}

/**
 * Automatically provisions an isolated enterprise database for a dedicated tenant:
 * 1. Connects to the PostgreSQL cluster and creates `tenant_<sanitized_id>` if not exists.
 * 2. Connects to the new database and applies pending Drizzle migrations.
 * 3. Returns the dedicated database routing coordinates.
 */
export async function provisionDedicatedDatabase(
  tenantId: string,
): Promise<ProvisionDedicatedDbResult> {
  const sanitizedId = tenantId.replace(/-/g, '_');
  const databaseName = `tenant_${sanitizedId}`;
  const databaseKey = `dedicated-${tenantId}`;

  logger.info({ tenantId, databaseName }, 'Initiating dedicated database provisioning');

  // Step 1: Connect to PostgreSQL cluster root to ensure database exists
  const rootClient = postgres(env.DATABASE_URL, { max: 1, idle_timeout: 10 });
  try {
    const existing = await rootClient`
      SELECT 1 FROM pg_database WHERE datname = ${databaseName}
    `;

    if (existing.length === 0) {
      await rootClient.unsafe(`CREATE DATABASE "${databaseName}"`);
      logger.info({ databaseName }, 'Created dedicated PostgreSQL database');
    } else {
      logger.info({ databaseName }, 'Dedicated PostgreSQL database already exists');
    }
  } finally {
    await rootClient.end({ timeout: 5 }).catch(() => {});
  }

  // Step 2: Connect to the newly created database and run Drizzle migrations
  const targetUrl = new URL(env.DATABASE_URL);
  targetUrl.pathname = `/${databaseName}`;

  const migrationClient = postgres(targetUrl.toString(), { max: 1, idle_timeout: 10 });
  const migrationDb = drizzle({ client: migrationClient, schema }) as unknown as Database;

  try {
    await migrate(migrationDb, { migrationsFolder: './drizzle' });
    logger.info({ databaseName }, 'Successfully executed Drizzle migrations on dedicated database');
  } finally {
    await migrationClient.end({ timeout: 5 }).catch(() => {});
  }

  return {
    databaseName,
    databaseKey,
    schemaVersion: '1.0.0',
  };
}
