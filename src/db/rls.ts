import { sql } from 'drizzle-orm';

import { db as defaultDb, type Database } from '@/config/db';

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
  dbInstance: Database = defaultDb,
): Promise<T> {
  return dbInstance.transaction(async (tx) => {
    // Switch to non-superuser role so Postgres kernel enforces RLS
    await tx.execute(sql`SET LOCAL ROLE tenant_app_role`);
    // Transaction-local configuration (third argument `true` specifies transaction-scope)
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return callback(tx);
  });
}

/**
 * SQL statements generator to configure PostgreSQL Row-Level Security (RLS) on tenant-owned tables.
 * Defense-in-depth: guarantees that even if an application query omits `WHERE tenant_id = ...`,
 * PostgreSQL engine enforces isolation at the database kernel level.
 */
export function generateTenantRlsDdl(
  tableName: string,
  tenantIdColumn = 'tenantId',
  allowNullTenant = false,
): string {
  const nullCheck = allowNullTenant ? `OR "${tenantIdColumn}" IS NULL ` : '';
  return `
-- Enable Row Level Security (RLS)
ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY;

-- Drop existing policy if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "${tableName}";

-- Create kernel-level tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "${tableName}"
  USING (
    "${tenantIdColumn}" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ${nullCheck}OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  )
  WITH CHECK (
    "${tenantIdColumn}" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ${nullCheck}OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  );
`;
}
