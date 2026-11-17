import { sql } from 'drizzle-orm';

import { db as defaultDb, type Database } from '@/config/db';
import { currentTenantCtx, runWithTenantDb, tenantDb } from '@/db/tenancy/context';

/**
 * Executes a callback within a transaction where `app.tenant_id` is set locally.
 * Setting `is_local = true` ensures the configuration parameter is scoped strictly to
 * the active transaction and reset when the connection returns to the pool, preventing
 * cross-request leakage.
 *
 * Switches to `tenant_app_role` within the transaction so PostgreSQL kernel-level
 * Row-Level Security (RLS) is strictly enforced even if the pool connection connects
 * as a superuser.
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  callback: (tx: any) => Promise<T>,
  dbInstance?: Database,
): Promise<T> {
  const currentCtx = currentTenantCtx();
  const targetDb =
    dbInstance ??
    (currentCtx?.tenantId === tenantId ? tenantDb() : defaultDb);

  return targetDb.transaction(async (tx) => {
    // Switch to non-superuser role so Postgres kernel enforces RLS
    await tx.execute(sql`SET LOCAL ROLE tenant_app_role`);
    // Transaction-local configuration (third argument `true` specifies transaction-scope)
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);

    // Propagate transaction-bound executor to tenantDb() callers within the callback
    return runWithTenantDb(
      {
        tenantId,
        db: (tx as unknown as Database),
        tx,
        databaseMode: currentCtx?.databaseMode ?? 'shared',
      },
      () => callback(tx),
    );
  });
}

/**
 * Executes a callback within a transaction switched to `app_platform_role` to perform
 * cross-tenant maintenance tasks (e.g. billing reconciliation, retention purges).
 */
export async function withPlatformTransaction<T>(
  callback: (tx: any) => Promise<T>,
  dbInstance?: Database,
): Promise<T> {
  const targetDb = dbInstance ?? defaultDb;
  return targetDb.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_platform_role`);
    return callback(tx);
  });
}

/**
 * SQL statements generator to configure PostgreSQL Row-Level Security (RLS) on tenant-owned tables.
 * Strict semantics:
 * - When app.tenant_id is missing or empty, evaluates to false/no rows visible.
 * - For tables like AppRole where system roles have tenantId IS NULL, allows read access only (USING).
 * - WITH CHECK enforces that tenantId is strictly bound to app.tenant_id (never NULL).
 * - Generates permissive bypass policy for app_platform_role.
 */
export function generateTenantRlsDdl(
  tableName: string,
  tenantIdColumn = 'tenantId',
  allowNullTenant = false,
): string {
  // Read condition: tenant matches app.tenant_id (or NULL for system roles if allowNullTenant=true)
  const readCondition = allowNullTenant
    ? `("${tenantIdColumn}" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR "${tenantIdColumn}" IS NULL)`
    : `("${tenantIdColumn}" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`;

  // Write condition (WITH CHECK): NEVER allows NULL tenantId
  const writeCondition = `("${tenantIdColumn}" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`;

  return `
-- Enable Row Level Security (RLS)
ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "${tableName}";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "${tableName}";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "${tableName}"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (${readCondition})
  WITH CHECK (${writeCondition});

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "${tableName}"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);
`;
}

/**
 * Applies RLS policies across all tenant-scoped tables on the target PostgreSQL connection.
 * Idempotent: ensures `tenant_app_role` and `app_platform_role` exist, grants privileges, enables RLS, and applies policies.
 */
export async function applyTenantRlsPolicies(
  client: any,
  tenantTables: { name: string; tenantColumn: string }[],
): Promise<void> {
  // Ensure roles exist
  await client.unsafe(`
    DO $$ 
    BEGIN 
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tenant_app_role') THEN 
        CREATE ROLE tenant_app_role NOINHERIT NOSUPERUSER NOBYPASSRLS; 
      END IF; 
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_platform_role') THEN 
        CREATE ROLE app_platform_role NOINHERIT NOSUPERUSER NOBYPASSRLS; 
      END IF; 
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN 
        CREATE ROLE app_runtime NOINHERIT NOSUPERUSER NOBYPASSRLS; 
      END IF; 
    END $$;
  `);

  for (const { name, tenantColumn } of tenantTables) {
    try {
      const allowNullTenant = name === 'AppRole';
      const ddl = generateTenantRlsDdl(name, tenantColumn, allowNullTenant);
      await client.unsafe(ddl);

      // Narrow explicit grants on this table
      await client.unsafe(`
        GRANT SELECT, INSERT, UPDATE, DELETE ON "${name}" TO tenant_app_role, app_runtime, app_platform_role;
      `);
    } catch {
      // Table might not exist yet if migrations haven't created it
    }
  }

  // Grant sequence usage
  try {
    await client.unsafe(`
      GRANT USAGE ON SCHEMA public TO tenant_app_role, app_runtime, app_platform_role;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tenant_app_role, app_runtime, app_platform_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tenant_app_role, app_runtime, app_platform_role;
    `);
  } catch {
    // Ignore schema grant errors if not permitted
  }
}
