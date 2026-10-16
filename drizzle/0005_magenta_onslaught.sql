CREATE TABLE "TenantBranding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"companyName" text,
	"logoUrl" text,
	"logoDarkUrl" text,
	"faviconUrl" text,
	"primaryColor" text DEFAULT '#4F46E5' NOT NULL,
	"accentColor" text DEFAULT '#06B6D4' NOT NULL,
	"borderRadius" text DEFAULT '0.5rem' NOT NULL,
	"customDomain" text,
	"customDomainStatus" text DEFAULT 'PENDING' NOT NULL,
	"supportEmail" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "TenantBranding" ADD CONSTRAINT "TenantBranding_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "TenantBranding_tenantId_unique" ON "TenantBranding" USING btree ("tenantId");--> statement-breakpoint
CREATE UNIQUE INDEX "TenantBranding_customDomain_unique" ON "TenantBranding" USING btree ("customDomain");--> statement-breakpoint
CREATE INDEX "TenantBranding_customDomain_idx" ON "TenantBranding" USING btree ("customDomain");