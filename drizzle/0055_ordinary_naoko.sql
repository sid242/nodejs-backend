CREATE TYPE "public"."AccountDeletionStatus" AS ENUM('COOLING_PERIOD', 'ANONYMIZED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."ConsentType" AS ENUM('TERMS', 'PRIVACY', 'MARKETING', 'COOKIES');--> statement-breakpoint
CREATE TYPE "public"."DataExportScope" AS ENUM('USER', 'TENANT');--> statement-breakpoint
CREATE TYPE "public"."DataExportStatus" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."TenantTombstoneReason" AS ENUM('REQUESTED_BY_OWNER', 'INACTIVITY', 'TERMS_VIOLATION', 'LEGAL');--> statement-breakpoint
CREATE TABLE "ConsentRecord" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"tenantId" uuid,
	"type" "ConsentType" NOT NULL,
	"version" text NOT NULL,
	"ip" text,
	"userAgent" text,
	"acceptedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "LegalDocument" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "ConsentType" NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"contentSummary" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"effectiveAt" timestamp (3) DEFAULT now() NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "DataExportRequest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"tenantId" uuid,
	"scope" "DataExportScope" DEFAULT 'USER' NOT NULL,
	"status" "DataExportStatus" DEFAULT 'PENDING' NOT NULL,
	"fileKey" text,
	"downloadUrl" text,
	"fileSizeBytes" integer,
	"errorMessage" text,
	"expiresAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"completedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "AccountDeletionRequest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"status" "AccountDeletionStatus" DEFAULT 'COOLING_PERIOD' NOT NULL,
	"reason" text,
	"cancellationSecretHash" text,
	"graceEndsAt" timestamp (3) NOT NULL,
	"requestedAt" timestamp (3) DEFAULT now() NOT NULL,
	"completedAt" timestamp (3),
	"canceledAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "TenantLegalHold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"reason" text NOT NULL,
	"placedByStaffId" uuid NOT NULL,
	"placedAt" timestamp (3) DEFAULT now() NOT NULL,
	"releasedAt" timestamp (3),
	"releasedByStaffId" uuid,
	"releaseReason" text
);
--> statement-breakpoint
CREATE TABLE "TenantTombstone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"reason" text DEFAULT 'REQUESTED_BY_OWNER' NOT NULL,
	"closedAt" timestamp (3) DEFAULT now() NOT NULL,
	"purgedAt" timestamp (3),
	"closedByUserId" uuid
);
--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "closedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "purgeScheduledAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "dataRegion" text DEFAULT 'ap-south-1' NOT NULL;--> statement-breakpoint
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "DataExportRequest" ADD CONSTRAINT "DataExportRequest_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "DataExportRequest" ADD CONSTRAINT "DataExportRequest_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantLegalHold" ADD CONSTRAINT "TenantLegalHold_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantLegalHold" ADD CONSTRAINT "TenantLegalHold_placedByStaffId_PlatformStaff_id_fk" FOREIGN KEY ("placedByStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantLegalHold" ADD CONSTRAINT "TenantLegalHold_releasedByStaffId_PlatformStaff_id_fk" FOREIGN KEY ("releasedByStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ConsentRecord_userId_idx" ON "ConsentRecord" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "ConsentRecord_type_idx" ON "ConsentRecord" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ConsentRecord_user_type_ver_idx" ON "ConsentRecord" USING btree ("userId","type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "LegalDocument_type_version_idx" ON "LegalDocument" USING btree ("type","version");--> statement-breakpoint
CREATE INDEX "LegalDocument_type_active_idx" ON "LegalDocument" USING btree ("type","isActive");--> statement-breakpoint
CREATE INDEX "DataExportRequest_userId_idx" ON "DataExportRequest" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "DataExportRequest_tenantId_idx" ON "DataExportRequest" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "DataExportRequest_status_idx" ON "DataExportRequest" USING btree ("status");--> statement-breakpoint
CREATE INDEX "DataExportRequest_createdAt_idx" ON "DataExportRequest" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "AccountDeletionRequest_userId_idx" ON "AccountDeletionRequest" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "AccountDeletionRequest_status_idx" ON "AccountDeletionRequest" USING btree ("status");--> statement-breakpoint
CREATE INDEX "AccountDeletionRequest_graceEndsAt_idx" ON "AccountDeletionRequest" USING btree ("graceEndsAt");--> statement-breakpoint
CREATE INDEX "TenantLegalHold_tenantId_idx" ON "TenantLegalHold" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "TenantLegalHold_releasedAt_idx" ON "TenantLegalHold" USING btree ("releasedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "TenantTombstone_slug_idx" ON "TenantTombstone" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "TenantTombstone_tenantId_idx" ON "TenantTombstone" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "TenantTombstone_closedAt_idx" ON "TenantTombstone" USING btree ("closedAt");--> statement-breakpoint
CREATE INDEX "Tenant_closedAt_idx" ON "Tenant" USING btree ("closedAt");--> statement-breakpoint
CREATE INDEX "Tenant_purgeScheduledAt_idx" ON "Tenant" USING btree ("purgeScheduledAt");