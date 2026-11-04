CREATE TABLE "BillingWebhook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"eventId" text NOT NULL,
	"eventType" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PROCESSED' NOT NULL,
	"processedAt" timestamp (3) DEFAULT now() NOT NULL,
	"errorMessage" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "EntitlementDefinition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'INTEGER' NOT NULL,
	"unit" text,
	"validation" jsonb,
	"defaultValue" jsonb NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PlanEntitlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planId" uuid NOT NULL,
	"entitlementKey" text NOT NULL,
	"value" jsonb NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TenantEntitlementOverride" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"entitlementKey" text NOT NULL,
	"value" jsonb NOT NULL,
	"expiresAt" timestamp (3),
	"reason" text,
	"createdBy" text DEFAULT 'system' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TenantUsageRecord" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"entitlementKey" text NOT NULL,
	"currentUsage" integer DEFAULT 0 NOT NULL,
	"lastRecordedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "billingInterval" text DEFAULT 'MONTHLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "billingEmail" text;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "billingInterval" text DEFAULT 'MONTHLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "seatCount" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "internalNotes" text;--> statement-breakpoint
ALTER TABLE "PlanEntitlement" ADD CONSTRAINT "PlanEntitlement_planId_Plan_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantEntitlementOverride" ADD CONSTRAINT "TenantEntitlementOverride_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantUsageRecord" ADD CONSTRAINT "TenantUsageRecord_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "BillingWebhook_provider_event_unique" ON "BillingWebhook" USING btree ("provider","eventId");--> statement-breakpoint
CREATE INDEX "BillingWebhook_status_idx" ON "BillingWebhook" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "EntitlementDefinition_key_unique" ON "EntitlementDefinition" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "PlanEntitlement_plan_key_unique" ON "PlanEntitlement" USING btree ("planId","entitlementKey");--> statement-breakpoint
CREATE INDEX "PlanEntitlement_planId_idx" ON "PlanEntitlement" USING btree ("planId");--> statement-breakpoint
CREATE INDEX "PlanEntitlement_key_idx" ON "PlanEntitlement" USING btree ("entitlementKey");--> statement-breakpoint
CREATE INDEX "TenantEntitlementOverride_tenant_key_idx" ON "TenantEntitlementOverride" USING btree ("tenantId","entitlementKey");--> statement-breakpoint
CREATE INDEX "TenantEntitlementOverride_expiresAt_idx" ON "TenantEntitlementOverride" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "TenantUsageRecord_tenant_key_unique" ON "TenantUsageRecord" USING btree ("tenantId","entitlementKey");--> statement-breakpoint
CREATE INDEX "TenantUsageRecord_tenantId_idx" ON "TenantUsageRecord" USING btree ("tenantId");