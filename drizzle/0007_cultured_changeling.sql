CREATE TYPE "public"."EmailTemplateCategory" AS ENUM('MARKETING', 'TRANSACTIONAL', 'NOTIFICATION', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."EmailTemplateStatus" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "EmailTemplate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"subject" text NOT NULL,
	"category" "EmailTemplateCategory" DEFAULT 'CUSTOM' NOT NULL,
	"status" "EmailTemplateStatus" DEFAULT 'DRAFT' NOT NULL,
	"description" text,
	"htmlContent" text NOT NULL,
	"designJson" jsonb,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"createdById" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "EmailTemplate_tenantId_slug_unique" ON "EmailTemplate" USING btree ("tenantId","slug");--> statement-breakpoint
CREATE INDEX "EmailTemplate_tenantId_createdAt_idx" ON "EmailTemplate" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE INDEX "EmailTemplate_tenantId_status_createdAt_idx" ON "EmailTemplate" USING btree ("tenantId","status","createdAt");--> statement-breakpoint
CREATE INDEX "EmailTemplate_tenantId_category_createdAt_idx" ON "EmailTemplate" USING btree ("tenantId","category","createdAt");