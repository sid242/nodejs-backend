CREATE TABLE "TenantSlugHistory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"oldSlug" text NOT NULL,
	"changedAt" timestamp (3) DEFAULT now() NOT NULL,
	"expiresAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "TenantSlugHistory" ADD CONSTRAINT "TenantSlugHistory_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "TenantSlugHistory_oldSlug_idx" ON "TenantSlugHistory" USING btree ("oldSlug");--> statement-breakpoint
CREATE INDEX "TenantSlugHistory_tenantId_idx" ON "TenantSlugHistory" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "TenantSlugHistory_expiresAt_idx" ON "TenantSlugHistory" USING btree ("expiresAt");