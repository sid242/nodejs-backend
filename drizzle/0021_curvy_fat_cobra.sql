CREATE TYPE "public"."AddressOwnerType" AS ENUM('USER', 'TENANT', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."AddressType" AS ENUM('HOME', 'WORK', 'BILLING', 'SHIPPING', 'REGISTERED', 'BRANCH', 'OTHER');--> statement-breakpoint
CREATE TABLE "Address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerType" "AddressOwnerType" NOT NULL,
	"ownerId" uuid NOT NULL,
	"tenantId" uuid,
	"type" "AddressType" DEFAULT 'OTHER' NOT NULL,
	"label" text,
	"isDefault" boolean DEFAULT false NOT NULL,
	"recipientName" text,
	"phone" text,
	"line1" text NOT NULL,
	"line2" text,
	"landmark" text,
	"postalCode" text,
	"countryCode" text DEFAULT 'IN' NOT NULL,
	"stateGeoId" bigint,
	"districtGeoId" bigint,
	"subdistrictGeoId" bigint,
	"localityGeoId" bigint,
	"localityKind" text,
	"areaGeoId" bigint,
	"stateName" text,
	"districtName" text,
	"subdistrictName" text,
	"localityName" text,
	"areaName" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"deletedAt" timestamp (3)
);
--> statement-breakpoint
ALTER TABLE "Address" ADD CONSTRAINT "Address_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Address_owner_idx" ON "Address" USING btree ("ownerType","ownerId");--> statement-breakpoint
CREATE INDEX "Address_tenantId_idx" ON "Address" USING btree ("tenantId");--> statement-breakpoint
CREATE UNIQUE INDEX "Address_default_unique" ON "Address" USING btree ("ownerType","ownerId","type") WHERE "Address"."isDefault" = true AND "Address"."deletedAt" IS NULL;--> statement-breakpoint
ALTER TABLE "Address" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "Address" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "Address";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "Address" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR "tenantId" IS NULL OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR "tenantId" IS NULL OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);
