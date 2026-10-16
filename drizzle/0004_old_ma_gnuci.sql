CREATE TABLE "TenantEmailConfig" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 587 NOT NULL,
	"secure" boolean DEFAULT false NOT NULL,
	"user" text NOT NULL,
	"passwordEncrypted" text NOT NULL,
	"fromEmail" text NOT NULL,
	"fromName" text,
	"replyTo" text,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "TenantEmailConfig" ADD CONSTRAINT "TenantEmailConfig_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "TenantEmailConfig_tenantId_unique" ON "TenantEmailConfig" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "TenantEmailConfig_tenantId_idx" ON "TenantEmailConfig" USING btree ("tenantId");