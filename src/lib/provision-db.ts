import crypto from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { type Database } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import * as schema from '@/db/schema';
import { getLatestSchemaTag } from '@/db/schema-version';
import { applyTenantRlsPolicies } from '@/db/tenancy/rls';
import { TENANT_TABLES } from '@/db/tenancy/tenant-tables';
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
  tenantAppRole: string;
  connectionUrl: string;
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
 * 1. Uses DB_PROVISIONER_URL if configured, falling back to admin credentials or primary URL.
 * 2. Connects to cluster administrative root and creates the isolated database.
 * 3. Creates a dedicated login role (tenant_<id>_app) with NOBYPASSRLS and grants schema privileges.
 * 4. Connects to target database and executes pending Drizzle migrations.
 * 5. Applies PostgreSQL Row-Level Security (RLS) policies and configures tenant_app_role.
 * 6. Returns routing coordinates, connection URL, and current schema version.
 */
export async function provisionDedicatedDatabase(
  tenantId: string,
  options?: DedicatedDbConfigOptions,
): Promise<ProvisionDedicatedDbResult> {
  const defaultSanitizedId = tenantId.replace(/-/g, '_');
  const rawDbName = options?.customDatabaseName?.trim() || `tenant_${defaultSanitizedId}`;
  const databaseName = sanitizeDbIdentifier(rawDbName);
  const databaseKey = options?.customDatabaseKey?.trim() || `dedicated-${tenantId}`;
  const poolLimit =
    options?.poolLimit && options.poolLimit >= 1 && options.poolLimit <= 50 ? options.poolLimit : 5;
  const adminConnectionUrl =
    process.env.DB_PROVISIONER_URL?.trim() || options?.connectionUrl?.trim() || env.DATABASE_URL;

  const tenantAppRole = sanitizeDbIdentifier(`tenant_${defaultSanitizedId}_app`);
  const tenantAppPassword = crypto.randomBytes(24).toString('base64url');

  logger.info(
    {
      tenantId,
      databaseName,
      databaseKey,
      poolLimit,
      tenantAppRole,
      hasCustomUrl: Boolean(options?.connectionUrl),
      hasProvisionerUrl: Boolean(process.env.DB_PROVISIONER_URL),
    },
    'Initiating dedicated database provisioning',
  );

  // Step 1: Connect to the cluster root database (postgres or default in URL)
  const rootClient = postgres(adminConnectionUrl, { max: 1, idle_timeout: 10 });
  try {
    const existing = await rootClient`
      SELECT 1 FROM pg_database WHERE datname = ${databaseName}
    `;

    if (existing?.length === 0) {
      await rootClient.unsafe(`CREATE DATABASE "${databaseName}"`);
      logger.info({ databaseName }, 'Successfully created dedicated PostgreSQL database');
    } else {
      logger.info(
        { databaseName },
        'Dedicated PostgreSQL database already exists, proceeding with role setup and migrations',
      );
    }

    // Create or update dedicated tenant login role with NOBYPASSRLS
    await rootClient.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${tenantAppRole}') THEN
          CREATE ROLE "${tenantAppRole}" WITH LOGIN PASSWORD '${tenantAppPassword}' NOINHERIT NOBYPASSRLS;
        ELSE
          ALTER ROLE "${tenantAppRole}" WITH PASSWORD '${tenantAppPassword}';
        END IF;
      END $$;
    `);

    await rootClient.unsafe(`
      GRANT CONNECT ON DATABASE "${databaseName}" TO "${tenantAppRole}";
    `);
  } catch (err: unknown) {
    logger.error({ err, databaseName }, 'Failed to create dedicated PostgreSQL database or role');
    throw AppError.internal(
      `Failed to initialize dedicated PostgreSQL database: ${(err as Error)?.message ?? 'Unknown cluster error'}`,
    );
  } finally {
    await rootClient.end({ timeout: 5 }).catch(() => {});
  }

  // Step 2: Connect to target database as admin to run migrations and grant permissions
  const targetAdminUrl = new URL(adminConnectionUrl);
  targetAdminUrl.pathname = `/${databaseName}`;

  const adminDbClient = postgres(targetAdminUrl.toString(), { max: 2, idle_timeout: 10 });
  const migrationDb = drizzle({ client: adminDbClient, schema }) as unknown as Database;

  try {
    // 2a. Run Drizzle migrations
    await migrate(migrationDb, { migrationsFolder: './drizzle' });
    logger.info({ databaseName }, 'Successfully executed Drizzle migrations on dedicated database');

    // 2b. Grant permissions to tenant app role
    await adminDbClient.unsafe(`
      GRANT USAGE, CREATE ON SCHEMA public TO "${tenantAppRole}";
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${tenantAppRole}";
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${tenantAppRole}";
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${tenantAppRole}";
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${tenantAppRole}";
    `);

    // 2c. Apply RLS policies to all tenant tables
    await applyTenantRlsPolicies(adminDbClient, TENANT_TABLES);
    logger.info({ databaseName }, 'Successfully applied RLS policies on dedicated database');
  } catch (err: unknown) {
    logger.error({ err, databaseName }, 'Failed to configure migrations/RLS on dedicated database');
    throw AppError.internal(
      `Failed to configure dedicated database: ${(err as Error)?.message ?? 'Configuration failure'}`,
    );
  } finally {
    await adminDbClient.end({ timeout: 5 }).catch(() => {});
  }

  // Step 3: Construct the tenant application connection URL using the isolated tenant role
  const appConnectionUrl = new URL(adminConnectionUrl);
  appConnectionUrl.username = tenantAppRole;
  appConnectionUrl.password = tenantAppPassword;
  appConnectionUrl.pathname = `/${databaseName}`;

  const currentSchemaVersion = getLatestSchemaTag();

  return {
    databaseName,
    databaseKey,
    poolLimit,
    schemaVersion: currentSchemaVersion,
    tenantAppRole,
    connectionUrl: appConnectionUrl.toString(),
  };
}
