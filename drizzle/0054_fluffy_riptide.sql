CREATE TYPE "public"."AnnouncementAudience" AS ENUM('ALL', 'PLAN', 'TENANT', 'ROLE');--> statement-breakpoint
CREATE TYPE "public"."AnnouncementSeverity" AS ENUM('INFO', 'MAINTENANCE', 'INCIDENT', 'FEATURE');--> statement-breakpoint
CREATE TYPE "public"."AnnouncementStatus" AS ENUM('DRAFT', 'SCHEDULED', 'LIVE', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."FeatureFlagTarget" AS ENUM('TENANT', 'PLAN', 'USER', 'PERCENT', 'ENV');--> statement-breakpoint
CREATE TYPE "public"."FeatureFlagType" AS ENUM('BOOLEAN', 'PERCENT', 'VARIANT');--> statement-breakpoint
CREATE TABLE "FeatureFlagRule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flagId" uuid NOT NULL,
	"flagKey" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"target" "FeatureFlagTarget" NOT NULL,
	"matchCriteria" jsonb,
	"value" jsonb NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "FeatureFlag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "FeatureFlagType" DEFAULT 'BOOLEAN' NOT NULL,
	"defaultValue" jsonb DEFAULT 'false'::jsonb NOT NULL,
	"ownerStaffId" uuid,
	"killSwitch" boolean DEFAULT false NOT NULL,
	"tags" text[],
	"lastEvaluatedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "FeatureFlag_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "AnnouncementDismissal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcementId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"dismissedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Announcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" "AnnouncementSeverity" DEFAULT 'INFO' NOT NULL,
	"audience" "AnnouncementAudience" DEFAULT 'ALL' NOT NULL,
	"audienceFilter" jsonb,
	"startsAt" timestamp (3) DEFAULT now() NOT NULL,
	"endsAt" timestamp (3),
	"dismissible" boolean DEFAULT true NOT NULL,
	"link" text,
	"status" "AnnouncementStatus" DEFAULT 'LIVE' NOT NULL,
	"createdByStaffId" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ChangelogEntry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tags" text[],
	"publishedAt" timestamp (3) DEFAULT now() NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "MaintenanceConfig" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text DEFAULT 'GLOBAL' NOT NULL,
	"tenantId" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"readOnly" boolean DEFAULT false NOT NULL,
	"message" text,
	"startsAt" timestamp (3),
	"endsAt" timestamp (3),
	"allowStaff" boolean DEFAULT true NOT NULL,
	"updatedByStaffId" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "FeatureFlagRule" ADD CONSTRAINT "FeatureFlagRule_flagId_FeatureFlag_id_fk" FOREIGN KEY ("flagId") REFERENCES "public"."FeatureFlag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_ownerStaffId_PlatformStaff_id_fk" FOREIGN KEY ("ownerStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AnnouncementDismissal" ADD CONSTRAINT "AnnouncementDismissal_announcementId_Announcement_id_fk" FOREIGN KEY ("announcementId") REFERENCES "public"."Announcement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AnnouncementDismissal" ADD CONSTRAINT "AnnouncementDismissal_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdByStaffId_PlatformStaff_id_fk" FOREIGN KEY ("createdByStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MaintenanceConfig" ADD CONSTRAINT "MaintenanceConfig_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MaintenanceConfig" ADD CONSTRAINT "MaintenanceConfig_updatedByStaffId_PlatformStaff_id_fk" FOREIGN KEY ("updatedByStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "FeatureFlagRule_flagId_priority_idx" ON "FeatureFlagRule" USING btree ("flagId","priority");--> statement-breakpoint
CREATE INDEX "FeatureFlagRule_flagKey_idx" ON "FeatureFlagRule" USING btree ("flagKey");--> statement-breakpoint
CREATE UNIQUE INDEX "FeatureFlag_key_idx" ON "FeatureFlag" USING btree ("key");--> statement-breakpoint
CREATE INDEX "FeatureFlag_type_idx" ON "FeatureFlag" USING btree ("type");--> statement-breakpoint
CREATE INDEX "FeatureFlag_killSwitch_idx" ON "FeatureFlag" USING btree ("killSwitch");--> statement-breakpoint
CREATE UNIQUE INDEX "AnnouncementDismissal_announcement_user_idx" ON "AnnouncementDismissal" USING btree ("announcementId","userId");--> statement-breakpoint
CREATE INDEX "AnnouncementDismissal_userId_idx" ON "AnnouncementDismissal" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Announcement_status_startsAt_endsAt_idx" ON "Announcement" USING btree ("status","startsAt","endsAt");--> statement-breakpoint
CREATE INDEX "Announcement_audience_idx" ON "Announcement" USING btree ("audience");--> statement-breakpoint
CREATE INDEX "ChangelogEntry_publishedAt_idx" ON "ChangelogEntry" USING btree ("publishedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ChangelogEntry_version_idx" ON "ChangelogEntry" USING btree ("version");--> statement-breakpoint
CREATE INDEX "MaintenanceConfig_scope_enabled_idx" ON "MaintenanceConfig" USING btree ("scope","enabled");--> statement-breakpoint
CREATE INDEX "MaintenanceConfig_tenantId_idx" ON "MaintenanceConfig" USING btree ("tenantId");