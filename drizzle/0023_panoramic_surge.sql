CREATE TYPE "public"."OutboxStatus" AS ENUM('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');--> statement-breakpoint
CREATE TABLE "OutboxEvent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid,
	"eventType" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "OutboxStatus" DEFAULT 'PENDING' NOT NULL,
	"retryCount" integer DEFAULT 0 NOT NULL,
	"maxRetries" integer DEFAULT 5 NOT NULL,
	"lastError" text,
	"processedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "UserGroup_platform_slug_unique";--> statement-breakpoint
DROP INDEX "UserGroup_tenant_slug_unique";--> statement-breakpoint
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "OutboxEvent" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "OutboxEvent_tenantId_status_idx" ON "OutboxEvent" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "OutboxEvent_eventType_idx" ON "OutboxEvent" USING btree ("eventType");--> statement-breakpoint
CREATE UNIQUE INDEX "UserGroup_platform_slug_unique" ON "UserGroup" USING btree ("slug") WHERE "scope" = 'PLATFORM' AND "archivedAt" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "UserGroup_tenant_slug_unique" ON "UserGroup" USING btree ("tenantId","slug") WHERE "scope" = 'TENANT' AND "archivedAt" IS NULL;