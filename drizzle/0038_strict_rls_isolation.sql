-- ==========================================================================
-- Enterprise Row-Level Security (RLS) Roles & Policy Hardening
-- ==========================================================================
DO $$
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


-- Enable Row Level Security (RLS)
ALTER TABLE "TenantBranding" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "TenantBranding" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantBranding";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "TenantBranding";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "TenantBranding"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "TenantBranding"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "TenantBranding" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "AppRole" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "AppRole" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "AppRole";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "AppRole";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "AppRole"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR "tenantId" IS NULL))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "AppRole"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "AppRole" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "TenantMember" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "TenantMember" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantMember";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "TenantMember";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "TenantMember"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "TenantMember"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "TenantMember" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "TenantInvitation" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "TenantInvitation" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantInvitation";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "TenantInvitation";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "TenantInvitation"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "TenantInvitation"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "TenantInvitation" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "File" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "File" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "File";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "File";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "File"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "File"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "File" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "EmailTemplate" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "EmailTemplate" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "EmailTemplate";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "EmailTemplate";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "EmailTemplate"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "EmailTemplate"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "EmailTemplate" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "TenantEmailConfig" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "TenantEmailConfig" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantEmailConfig";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "TenantEmailConfig";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "TenantEmailConfig"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "TenantEmailConfig"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "TenantEmailConfig" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "Address" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "Address" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "Address";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "Address";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "Address"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "Address"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "Address" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "UserGroup" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "UserGroup" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "UserGroup";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "UserGroup";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "UserGroup"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "UserGroup"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "UserGroup" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "AuditLog";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "AuditLog";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "AuditLog"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "AuditLog"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "AuditLog" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "TenantAuditPolicy" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "TenantAuditPolicy" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantAuditPolicy";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "TenantAuditPolicy";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "TenantAuditPolicy"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "TenantAuditPolicy"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "TenantAuditPolicy" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "tenant_sso_configs" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "tenant_sso_configs" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "tenant_sso_configs";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "tenant_sso_configs";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "tenant_sso_configs"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "tenant_sso_configs"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_sso_configs" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "tenant_scim_tokens" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "tenant_scim_tokens" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "tenant_scim_tokens";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "tenant_scim_tokens";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "tenant_scim_tokens"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "tenant_scim_tokens"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_scim_tokens" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "TenantModule" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "TenantModule" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantModule";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "TenantModule";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "TenantModule"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "TenantModule"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "TenantModule" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "OutboxEvent" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "OutboxEvent";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "OutboxEvent";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "OutboxEvent"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "OutboxEvent"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "OutboxEvent" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "Lead" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "Lead";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "Lead";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "Lead"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "Lead"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "Lead" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "RolePermission" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "RolePermission";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "RolePermission";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "RolePermission"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (EXISTS (SELECT 1 FROM "AppRole" r WHERE r.id = "roleId" AND (r."tenantId" IS NULL OR r."tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)))
  WITH CHECK (EXISTS (SELECT 1 FROM "AppRole" r WHERE r.id = "roleId" AND (r."tenantId" IS NULL OR r."tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "RolePermission"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "RolePermission" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "TenantMemberRole" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "TenantMemberRole" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantMemberRole";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "TenantMemberRole";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "TenantMemberRole"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "TenantMemberRole"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "TenantMemberRole" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "UserGroupMember" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "UserGroupMember" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "UserGroupMember";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "UserGroupMember";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "UserGroupMember"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "UserGroupMember"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "UserGroupMember" TO tenant_app_role, app_runtime, app_platform_role;


-- Enable Row Level Security (RLS)
ALTER TABLE "UserGroupRole" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (prevents bypass when application role owns the table)
ALTER TABLE "UserGroupRole" FORCE ROW LEVEL SECURITY;

-- Drop existing policies if present
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "UserGroupRole";
DROP POLICY IF EXISTS "platform_bypass_policy" ON "UserGroupRole";

-- Create kernel-level strict tenant isolation policy
CREATE POLICY "tenant_isolation_policy" ON "UserGroupRole"
  FOR ALL
  TO tenant_app_role, app_runtime, public
  USING (EXISTS (SELECT 1 FROM "UserGroup" g WHERE g.id = "groupId" AND g."tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "UserGroup" g WHERE g.id = "groupId" AND g."tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid));

-- Create permissive platform bypass policy for maintenance & platform operator tasks
CREATE POLICY "platform_bypass_policy" ON "UserGroupRole"
  FOR ALL
  TO app_platform_role
  USING (true)
  WITH CHECK (true);


GRANT SELECT, INSERT, UPDATE, DELETE ON "UserGroupRole" TO tenant_app_role, app_runtime, app_platform_role;


GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tenant_app_role, app_runtime, app_platform_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tenant_app_role, app_runtime, app_platform_role;
