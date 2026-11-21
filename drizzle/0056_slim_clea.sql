CREATE TABLE "UsageDaily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"meter" text NOT NULL,
	"date" text NOT NULL,
	"quantity" bigint DEFAULT 0 NOT NULL,
	"unit" text DEFAULT 'count' NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UsageEvent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"meter" text NOT NULL,
	"quantity" bigint DEFAULT 1 NOT NULL,
	"unit" text DEFAULT 'count' NOT NULL,
	"occurredAt" timestamp (3) DEFAULT now() NOT NULL,
	"actorMemberId" uuid,
	"resourceType" text,
	"resourceId" text,
	"idempotencyKey" text
);
--> statement-breakpoint
CREATE TABLE "ActivityFeed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"actorId" uuid,
	"actorName" text,
	"actorAvatarUrl" text,
	"verb" text NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ReportDefinition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb,
	"columns" jsonb DEFAULT '[]'::jsonb,
	"format" text DEFAULT 'CSV' NOT NULL,
	"schedule" text,
	"recipients" jsonb DEFAULT '[]'::jsonb,
	"createdBy" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ReportRun" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"definitionId" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"fileKey" text,
	"downloadUrl" text,
	"rowCount" integer DEFAULT 0 NOT NULL,
	"fileSizeBytes" integer DEFAULT 0 NOT NULL,
	"startedAt" timestamp (3),
	"finishedAt" timestamp (3),
	"error" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PlatformMetricsDaily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" text NOT NULL,
	"mrrCents" integer DEFAULT 0 NOT NULL,
	"arrCents" integer DEFAULT 0 NOT NULL,
	"activeTenants" integer DEFAULT 0 NOT NULL,
	"newTenants" integer DEFAULT 0 NOT NULL,
	"churnedTenants" integer DEFAULT 0 NOT NULL,
	"totalStorageBytes" bigint DEFAULT 0 NOT NULL,
	"apiRequestsCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "UsageDaily" ADD CONSTRAINT "UsageDaily_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_actorMemberId_TenantMember_id_fk" FOREIGN KEY ("actorMemberId") REFERENCES "public"."TenantMember"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ActivityFeed" ADD CONSTRAINT "ActivityFeed_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ReportDefinition" ADD CONSTRAINT "ReportDefinition_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ReportDefinition" ADD CONSTRAINT "ReportDefinition_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_definitionId_ReportDefinition_id_fk" FOREIGN KEY ("definitionId") REFERENCES "public"."ReportDefinition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "UsageDaily_tenant_meter_date_idx" ON "UsageDaily" USING btree ("tenantId","meter","date");--> statement-breakpoint
CREATE INDEX "UsageDaily_tenantId_date_idx" ON "UsageDaily" USING btree ("tenantId","date");--> statement-breakpoint
CREATE UNIQUE INDEX "UsageEvent_idempotency_idx" ON "UsageEvent" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "UsageEvent_tenant_meter_date_idx" ON "UsageEvent" USING btree ("tenantId","meter","occurredAt");--> statement-breakpoint
CREATE INDEX "UsageEvent_tenant_occurredAt_idx" ON "UsageEvent" USING btree ("tenantId","occurredAt");--> statement-breakpoint
CREATE INDEX "ActivityFeed_tenantId_createdAt_idx" ON "ActivityFeed" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE INDEX "ActivityFeed_tenant_entity_idx" ON "ActivityFeed" USING btree ("tenantId","entityType","createdAt");--> statement-breakpoint
CREATE INDEX "ReportDefinition_tenantId_idx" ON "ReportDefinition" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "ReportDefinition_type_idx" ON "ReportDefinition" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ReportRun_tenantId_idx" ON "ReportRun" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "ReportRun_definitionId_idx" ON "ReportRun" USING btree ("definitionId");--> statement-breakpoint
CREATE INDEX "ReportRun_status_idx" ON "ReportRun" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ReportRun_createdAt_idx" ON "ReportRun" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformMetricsDaily_date_idx" ON "PlatformMetricsDaily" USING btree ("date");