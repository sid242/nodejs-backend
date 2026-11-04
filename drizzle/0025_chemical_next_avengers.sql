ALTER TABLE "Tenant" ADD COLUMN "legalName" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "tenantCode" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "locale" text DEFAULT 'en-US' NOT NULL;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "supportEmail" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "supportPhone" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "billingEmail" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "internalNote" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "provisioningStatus" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "provisioningStep" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "provisioningError" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "trialEndsAt" timestamp (3);--> statement-breakpoint
CREATE UNIQUE INDEX "Tenant_tenantCode_idx" ON "Tenant" USING btree ("tenantCode") WHERE "Tenant"."tenantCode" is not null;--> statement-breakpoint
CREATE INDEX "Tenant_country_idx" ON "Tenant" USING btree ("country");--> statement-breakpoint
CREATE INDEX "Tenant_provisioningStatus_idx" ON "Tenant" USING btree ("provisioningStatus");