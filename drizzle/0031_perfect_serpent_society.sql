CREATE TABLE "TenantAuditPolicy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"retentionDays" integer DEFAULT 90 NOT NULL,
	"exportAllowed" boolean DEFAULT true NOT NULL,
	"complianceFramework" text DEFAULT 'SOC2' NOT NULL,
	"lastArchivedAt" timestamp (3),
	"updatedBy" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "TenantAuditPolicy_tenantId_unique" UNIQUE("tenantId")
);
--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "actorUserId" uuid;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "effectiveUserId" uuid;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "source" text DEFAULT 'DIRECT' NOT NULL;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "result" text DEFAULT 'SUCCESS' NOT NULL;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "resourceType" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "resourceId" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "requestId" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "correlationId" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "metadataBefore" jsonb;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "metadataAfter" jsonb;--> statement-breakpoint
ALTER TABLE "TenantAuditPolicy" ADD CONSTRAINT "TenantAuditPolicy_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantAuditPolicy" ADD CONSTRAINT "TenantAuditPolicy_updatedBy_User_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "TenantAuditPolicy_tenantId_idx" ON "TenantAuditPolicy" USING btree ("tenantId");--> statement-breakpoint
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_User_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_effectiveUserId_User_id_fk" FOREIGN KEY ("effectiveUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AuditLog_tenantId_actorUserId_createdAt_idx" ON "AuditLog" USING btree ("tenantId","actorUserId","createdAt");--> statement-breakpoint
CREATE INDEX "AuditLog_tenantId_effectiveUserId_createdAt_idx" ON "AuditLog" USING btree ("tenantId","effectiveUserId","createdAt");--> statement-breakpoint
CREATE INDEX "AuditLog_tenantId_result_createdAt_idx" ON "AuditLog" USING btree ("tenantId","result","createdAt");--> statement-breakpoint
CREATE INDEX "AuditLog_tenantId_source_createdAt_idx" ON "AuditLog" USING btree ("tenantId","source","createdAt");--> statement-breakpoint
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog" USING btree ("requestId");--> statement-breakpoint
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog" USING btree ("correlationId");