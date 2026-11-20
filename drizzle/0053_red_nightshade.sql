CREATE TABLE "ApiKey" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"keyHash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"createdByMemberId" uuid,
	"lastUsedAt" timestamp (3),
	"lastUsedIp" text,
	"expiresAt" timestamp (3),
	"revokedAt" timestamp (3),
	"rateLimitPerMin" integer DEFAULT 60 NOT NULL,
	"allowedIps" text[] DEFAULT '{}' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WebhookDelivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpointId" uuid NOT NULL,
	"tenantId" uuid NOT NULL,
	"eventId" text NOT NULL,
	"eventType" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"responseStatus" integer,
	"responseBodySnippet" text,
	"durationMs" integer,
	"nextAttemptAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WebhookEndpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"secretEncrypted" text NOT NULL,
	"events" text[] NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"createdByMemberId" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdByMemberId_TenantMember_id_fk" FOREIGN KEY ("createdByMemberId") REFERENCES "public"."TenantMember"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_WebhookEndpoint_id_fk" FOREIGN KEY ("endpointId") REFERENCES "public"."WebhookEndpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_createdByMemberId_TenantMember_id_fk" FOREIGN KEY ("createdByMemberId") REFERENCES "public"."TenantMember"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ApiKey_keyHash_unique" ON "ApiKey" USING btree ("keyHash");--> statement-breakpoint
CREATE INDEX "ApiKey_tenant_prefix_idx" ON "ApiKey" USING btree ("tenantId","prefix");--> statement-breakpoint
CREATE INDEX "ApiKey_tenant_revoked_idx" ON "ApiKey" USING btree ("tenantId","revokedAt");--> statement-breakpoint
CREATE INDEX "ApiKey_tenant_created_idx" ON "ApiKey" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE INDEX "WebhookDelivery_endpoint_created_idx" ON "WebhookDelivery" USING btree ("endpointId","createdAt");--> statement-breakpoint
CREATE INDEX "WebhookDelivery_tenant_status_idx" ON "WebhookDelivery" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "WebhookDelivery_tenant_event_idx" ON "WebhookDelivery" USING btree ("tenantId","eventId");--> statement-breakpoint
CREATE INDEX "WebhookEndpoint_tenant_status_idx" ON "WebhookEndpoint" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "WebhookEndpoint_tenant_created_idx" ON "WebhookEndpoint" USING btree ("tenantId","createdAt");--> statement-breakpoint
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ApiKey" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "ApiKey";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "ApiKey" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "WebhookEndpoint" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "WebhookEndpoint" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "WebhookEndpoint";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "WebhookEndpoint" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "WebhookDelivery" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "WebhookDelivery";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "WebhookDelivery" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);