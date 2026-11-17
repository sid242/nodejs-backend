ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "authMethod" text NOT NULL DEFAULT 'PASSWORD';

ALTER TABLE "TenantMember" ADD COLUMN IF NOT EXISTS "externalId" text;
ALTER TABLE "TenantMember" ADD COLUMN IF NOT EXISTS "tokenVersion" integer NOT NULL DEFAULT 1;
ALTER TABLE "TenantMember" ADD COLUMN IF NOT EXISTS "statusChangedAt" timestamp(3);
CREATE INDEX IF NOT EXISTS "TenantMember_tenantId_externalId_idx" ON "TenantMember" ("tenantId", "externalId");

ALTER TABLE "tenant_scim_tokens" ADD COLUMN IF NOT EXISTS "allowed_ips" text[] NOT NULL DEFAULT '{}';
ALTER TABLE "tenant_scim_tokens" ADD COLUMN IF NOT EXISTS "last_used_ip" text;
