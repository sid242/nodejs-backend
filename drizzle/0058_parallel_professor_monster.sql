ALTER TABLE "Tenant" ADD COLUMN "signupSource" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "referralCode" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "referredByTenantId" uuid;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "utm" jsonb;