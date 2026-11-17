ALTER TABLE "TenantMember" ADD COLUMN IF NOT EXISTS "ssoBypass" boolean NOT NULL DEFAULT false;
