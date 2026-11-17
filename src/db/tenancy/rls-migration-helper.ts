import { generateTenantRlsDdl } from '@/db/tenancy/rls';
import { TENANT_TABLES } from '@/db/tenancy/tenant-tables';

/**
 * Generates SQL migration DDL to configure strict PostgreSQL Row-Level Security (RLS)
 * across all tenant-scoped tables in the application schema.
 */
export function generateFleetRlsMigrationSql(): string {
  const statements: string[] = [
    '-- ==========================================================================',
    '-- Enterprise Row-Level Security (RLS) Roles & Policy Hardening',
    '-- ==========================================================================',
    `DO $$
BEGIN
  -- 1. Tenant application runtime role (enforces RLS with app.tenant_id)
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tenant_app_role') THEN
    CREATE ROLE tenant_app_role NOSUPERUSER NOBYPASSRLS;
  END IF;

  -- 2. Platform operator & background worker role (bypasses RLS via policy)
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_platform_role') THEN
    CREATE ROLE app_platform_role NOSUPERUSER NOBYPASSRLS;
  END IF;

  -- 3. Base runtime role for standard API connections
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
`,
  ];

  // Apply RLS to every table in TENANT_TABLES
  for (const { name, tenantColumn } of TENANT_TABLES) {
    const allowNullTenant = name === 'AppRole';
    statements.push(generateTenantRlsDdl(name, tenantColumn, allowNullTenant));

    // Narrow and explicit grants
    statements.push(`
GRANT SELECT, INSERT, UPDATE, DELETE ON "${name}" TO tenant_app_role, app_runtime, app_platform_role;
`);
  }

  // Grant sequence usage
  statements.push(`
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tenant_app_role, app_runtime, app_platform_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tenant_app_role, app_runtime, app_platform_role;
`);

  return statements.join('\n');
}
