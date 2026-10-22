CREATE TABLE "PlanEntitlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planId" uuid NOT NULL,
	"maxMembers" integer DEFAULT 5 NOT NULL,
	"maxProjects" integer DEFAULT 10 NOT NULL,
	"maxStorageMb" integer DEFAULT 1024 NOT NULL,
	"hasCustomRoles" boolean DEFAULT false NOT NULL,
	"hasAdvancedAnalytics" boolean DEFAULT false NOT NULL,
	"hasPrioritySupport" boolean DEFAULT false NOT NULL,
	"hasAuditRetentionDays" integer DEFAULT 7 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"priceCents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"billingInterval" text DEFAULT 'MONTHLY' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"isPublic" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"planId" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"seatCount" integer DEFAULT 1 NOT NULL,
	"currentPeriodStart" timestamp (3) DEFAULT now() NOT NULL,
	"currentPeriodEnd" timestamp (3),
	"cancelAtPeriodEnd" boolean DEFAULT false NOT NULL,
	"canceledAt" timestamp (3),
	"trialEndsAt" timestamp (3),
	"provider" text DEFAULT 'MOCK' NOT NULL,
	"providerSubscriptionId" text,
	"providerCustomerId" text,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD COLUMN "targetUserId" uuid;--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD COLUMN "impersonatedRole" text;--> statement-breakpoint
ALTER TABLE "PlanEntitlement" ADD CONSTRAINT "PlanEntitlement_planId_Plan_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_Plan_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "PlanEntitlement_planId_unique" ON "PlanEntitlement" USING btree ("planId");--> statement-breakpoint
CREATE UNIQUE INDEX "Plan_key_unique" ON "Plan" USING btree ("key");--> statement-breakpoint
CREATE INDEX "Plan_isActive_idx" ON "Plan" USING btree ("isActive");--> statement-breakpoint
CREATE UNIQUE INDEX "Subscription_tenantId_unique" ON "Subscription" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "Subscription_planId_idx" ON "Subscription" USING btree ("planId");--> statement-breakpoint
CREATE INDEX "Subscription_status_idx" ON "Subscription" USING btree ("status");--> statement-breakpoint
CREATE INDEX "PlatformSupportSession_targetUserId_idx" ON "PlatformSupportSession" USING btree ("targetUserId");