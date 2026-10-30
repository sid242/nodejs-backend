DROP INDEX IF EXISTS "PlanModule_planId_idx";--> statement-breakpoint
ALTER TABLE "PlanModule" DROP CONSTRAINT IF EXISTS "PlanModule_planId_moduleId_pk";--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PlanModule_pkey'
  ) THEN
    ALTER TABLE "PlanModule" ADD CONSTRAINT "PlanModule_pkey" PRIMARY KEY("planId","moduleId");
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "urlStyle" text DEFAULT 'path' NOT NULL;--> statement-breakpoint
ALTER TABLE "TenantBranding" ADD COLUMN IF NOT EXISTS "customDomainVerifiedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "TenantBranding" ADD COLUMN IF NOT EXISTS "customDomainTlsStatus" text;--> statement-breakpoint
ALTER TABLE "TenantBranding" ALTER COLUMN "customDomainStatus" DROP DEFAULT;--> statement-breakpoint
UPDATE "TenantBranding" SET "customDomainStatus" = 'VERIFIED' WHERE "customDomainStatus" = 'ACTIVE';--> statement-breakpoint
UPDATE "TenantBranding" SET "customDomainStatus" = 'PENDING' WHERE "customDomainStatus" NOT IN ('PENDING', 'VERIFIED', 'FAILED');--> statement-breakpoint
ALTER TABLE "TenantBranding" ALTER COLUMN "customDomainStatus" SET DATA TYPE "public"."CustomDomainStatus" USING "customDomainStatus"::"public"."CustomDomainStatus";--> statement-breakpoint
ALTER TABLE "TenantBranding" ALTER COLUMN "customDomainStatus" SET DEFAULT 'PENDING'::"public"."CustomDomainStatus";--> statement-breakpoint
UPDATE "Plan"
SET "limits" = jsonb_set(
  "limits",
  '{urlAccess}',
  CASE "key"
    WHEN 'ENTERPRISE' THEN '{"path": true, "subdomain": true, "customDomain": true}'::jsonb
    WHEN 'PRO' THEN '{"path": true, "subdomain": true, "customDomain": false}'::jsonb
    ELSE '{"path": true, "subdomain": false, "customDomain": false}'::jsonb
  END,
  true
)
WHERE NOT ("limits" ? 'urlAccess');
