ALTER TABLE "User" DROP CONSTRAINT "User_email_unique";--> statement-breakpoint
ALTER TABLE "PlatformPermission" DROP CONSTRAINT "PlatformPermission_key_unique";--> statement-breakpoint
ALTER TABLE "PlatformRole" DROP CONSTRAINT "PlatformRole_key_unique";--> statement-breakpoint
ALTER TABLE "PlatformStaff" DROP CONSTRAINT "PlatformStaff_email_unique";--> statement-breakpoint
DROP INDEX "VerificationToken_tokenHash_type_idx";--> statement-breakpoint
DROP INDEX "TenantEmailConfig_tenantId_idx";--> statement-breakpoint
DROP INDEX "TenantBranding_customDomain_idx";--> statement-breakpoint
DROP INDEX "AppRole_tenantId_name_idx";--> statement-breakpoint
ALTER TABLE "File" ALTER COLUMN "size" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "File" ALTER COLUMN "tenantId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "TenantMemberRole" ADD COLUMN "tenantId" uuid;--> statement-breakpoint
UPDATE "TenantMemberRole" tmr SET "tenantId" = tm."tenantId" FROM "TenantMember" tm WHERE tmr."memberId" = tm."id" AND tmr."tenantId" IS NULL;--> statement-breakpoint
ALTER TABLE "TenantMemberRole" ADD CONSTRAINT "TenantMemberRole_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "User_email_active_unique" ON "User" USING btree ("email") WHERE "User"."deletedAt" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "AppRole_tenant_name_unique" ON "AppRole" USING btree ("tenantId","name") WHERE "AppRole"."tenantId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "AppRole_system_name_unique" ON "AppRole" USING btree ("name") WHERE "AppRole"."tenantId" is null;--> statement-breakpoint
CREATE INDEX "TenantMemberRole_tenantId_idx" ON "TenantMemberRole" USING btree ("tenantId");
--> statement-breakpoint
ALTER TABLE "File" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "File" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "File";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "File" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "AuditLog";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "AuditLog" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "TenantMember" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "TenantMember" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantMember";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "TenantMember" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "TenantMemberRole" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "TenantMemberRole" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantMemberRole";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "TenantMemberRole" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "TenantModule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "TenantModule" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantModule";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "TenantModule" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "TenantEmailConfig" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "TenantEmailConfig" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantEmailConfig";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "TenantEmailConfig" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "TenantBranding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "TenantBranding" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantBranding";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "TenantBranding" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "EmailTemplate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "EmailTemplate" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "EmailTemplate";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "EmailTemplate" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "TenantInvitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "TenantInvitation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "TenantInvitation";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "TenantInvitation" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "Subscription";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "Subscription" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "SubscriptionEvent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "SubscriptionEvent" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "SubscriptionEvent";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "SubscriptionEvent" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "Invoice";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "Invoice" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "AppRole" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "AppRole" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "AppRole";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "AppRole" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR "tenantId" IS NULL OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR "tenantId" IS NULL OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tenant_app_role') THEN
    CREATE ROLE tenant_app_role NOSUPERUSER NOBYPASSRLS;
  END IF;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO tenant_app_role;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO tenant_app_role;
  GRANT ALL ON SCHEMA public TO tenant_app_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO tenant_app_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO tenant_app_role;
  GRANT tenant_app_role TO CURRENT_USER;
END
$$;
