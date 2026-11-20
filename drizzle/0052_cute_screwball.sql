CREATE TYPE "public"."EmailDeliveryStatus" AS ENUM('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."EmailSuppressionReason" AS ENUM('BOUNCE', 'COMPLAINT', 'UNSUBSCRIBE', 'MANUAL');--> statement-breakpoint
CREATE TABLE "EmailMessage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"templateId" uuid,
	"templateSlug" text,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"status" "EmailDeliveryStatus" DEFAULT 'QUEUED' NOT NULL,
	"provider" text,
	"providerMessageId" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"lastError" text,
	"sentAt" timestamp (3),
	"deliveredAt" timestamp (3),
	"openedAt" timestamp (3),
	"relatedEntityType" text,
	"relatedEntityId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "EmailSuppression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"email" text NOT NULL,
	"reason" "EmailSuppressionReason" DEFAULT 'BOUNCE' NOT NULL,
	"details" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "EmailTemplateVersion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"templateId" uuid NOT NULL,
	"version" integer NOT NULL,
	"subject" text NOT NULL,
	"htmlContent" text NOT NULL,
	"designJson" jsonb,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"createdById" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "EmailTemplate_tenantId_slug_unique";--> statement-breakpoint
ALTER TABLE "TenantEmailConfig" ADD COLUMN "lastTestedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "TenantEmailConfig" ADD COLUMN "lastTestStatus" text;--> statement-breakpoint
ALTER TABLE "TenantEmailConfig" ADD COLUMN "dkimVerified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "TenantEmailConfig" ADD COLUMN "spfVerified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "TenantEmailConfig" ADD COLUMN "dailyLimit" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "EmailTemplate" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "EmailTemplate" ADD COLUMN "currentVersion" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "EmailTemplate" ADD COLUMN "isSystemOverride" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "EmailTemplate" ADD COLUMN "lastPublishedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_templateId_EmailTemplate_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."EmailTemplate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EmailSuppression" ADD CONSTRAINT "EmailSuppression_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EmailTemplateVersion" ADD CONSTRAINT "EmailTemplateVersion_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EmailTemplateVersion" ADD CONSTRAINT "EmailTemplateVersion_templateId_EmailTemplate_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."EmailTemplate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EmailTemplateVersion" ADD CONSTRAINT "EmailTemplateVersion_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "EmailMessage_tenantId_status_createdAt_idx" ON "EmailMessage" USING btree ("tenantId","status","createdAt");--> statement-breakpoint
CREATE INDEX "EmailMessage_tenantId_to_idx" ON "EmailMessage" USING btree ("tenantId","to");--> statement-breakpoint
CREATE INDEX "EmailMessage_tenantId_createdAt_idx" ON "EmailMessage" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailSuppression_tenantId_email_unique" ON "EmailSuppression" USING btree ("tenantId","email");--> statement-breakpoint
CREATE INDEX "EmailSuppression_tenantId_createdAt_idx" ON "EmailSuppression" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailTemplateVersion_tenantId_templateId_version_unique" ON "EmailTemplateVersion" USING btree ("tenantId","templateId","version");--> statement-breakpoint
CREATE INDEX "EmailTemplateVersion_tenantId_templateId_createdAt_idx" ON "EmailTemplateVersion" USING btree ("tenantId","templateId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailTemplate_tenantId_slug_locale_unique" ON "EmailTemplate" USING btree ("tenantId","slug","locale");--> statement-breakpoint
ALTER TABLE "EmailTemplateVersion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "EmailTemplateVersion" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "EmailTemplateVersion";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "EmailTemplateVersion" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "EmailMessage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "EmailMessage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "EmailMessage";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "EmailMessage" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "EmailSuppression" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "EmailSuppression" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "EmailSuppression";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "EmailSuppression" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);