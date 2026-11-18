CREATE TYPE "public"."NotificationCategory" AS ENUM('SECURITY', 'ACCOUNT', 'BILLING', 'TEAM', 'FILES', 'SYSTEM', 'PRODUCT');--> statement-breakpoint
CREATE TYPE "public"."NotificationDigest" AS ENUM('NONE', 'DAILY', 'WEEKLY');--> statement-breakpoint
CREATE TYPE "public"."NotificationSeverity" AS ENUM('INFO', 'SUCCESS', 'WARNING', 'CRITICAL');--> statement-breakpoint
ALTER TYPE "public"."SupportSessionScope" ADD VALUE 'ASSIST' BEFORE 'FULL';--> statement-breakpoint
ALTER TYPE "public"."SupportSessionScope" ADD VALUE 'FULL_ADMIN';--> statement-breakpoint
CREATE TABLE "TenantDbOperation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"requestedByStaffId" uuid,
	"approvedByStaffId" uuid,
	"reason" text NOT NULL,
	"params" jsonb,
	"progress" jsonb,
	"error" text,
	"startedAt" timestamp (3),
	"finishedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AuditRetentionRun" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid,
	"cutoffDate" timestamp (3) NOT NULL,
	"rowsArchived" integer DEFAULT 0 NOT NULL,
	"rowsPurged" integer DEFAULT 0 NOT NULL,
	"archiveS3Key" text,
	"archiveSha256" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"startedAt" timestamp (3) DEFAULT now() NOT NULL,
	"completedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "NotificationPreference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"tenantId" uuid,
	"category" "NotificationCategory" NOT NULL,
	"channelInApp" boolean DEFAULT true NOT NULL,
	"channelEmail" boolean DEFAULT true NOT NULL,
	"channelPush" boolean DEFAULT false NOT NULL,
	"digest" "NotificationDigest" DEFAULT 'NONE' NOT NULL,
	"quietHoursStart" text,
	"quietHoursEnd" text,
	"timezone" text DEFAULT 'UTC',
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid,
	"recipientUserId" uuid NOT NULL,
	"recipientMemberId" uuid,
	"type" text NOT NULL,
	"category" "NotificationCategory" DEFAULT 'SYSTEM' NOT NULL,
	"severity" "NotificationSeverity" DEFAULT 'INFO' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actorUserId" uuid,
	"dedupeKey" text,
	"readAt" timestamp (3),
	"archivedAt" timestamp (3),
	"expiresAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PushSubscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"userAgent" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"lastUsedAt" timestamp (3),
	CONSTRAINT "PushSubscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "authMethod" text DEFAULT 'PASSWORD' NOT NULL;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "externalId" text;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "tokenVersion" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "statusChangedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "ssoBypass" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_scim_tokens" ADD COLUMN "allowed_ips" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_scim_tokens" ADD COLUMN "last_used_ip" text;--> statement-breakpoint
ALTER TABLE "PlatformAuditLog" ADD COLUMN "actorEmail" text;--> statement-breakpoint
ALTER TABLE "PlatformAuditLog" ADD COLUMN "actorName" text;--> statement-breakpoint
ALTER TABLE "PlatformAuditLog" ADD COLUMN "prevHash" text;--> statement-breakpoint
ALTER TABLE "PlatformAuditLog" ADD COLUMN "rowHash" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "actorEmail" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "actorName" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "prevHash" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "rowHash" text;--> statement-breakpoint
ALTER TABLE "TenantDbOperation" ADD CONSTRAINT "TenantDbOperation_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantDbOperation" ADD CONSTRAINT "TenantDbOperation_requestedByStaffId_PlatformStaff_id_fk" FOREIGN KEY ("requestedByStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantDbOperation" ADD CONSTRAINT "TenantDbOperation_approvedByStaffId_PlatformStaff_id_fk" FOREIGN KEY ("approvedByStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AuditRetentionRun" ADD CONSTRAINT "AuditRetentionRun_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_User_id_fk" FOREIGN KEY ("recipientUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientMemberId_TenantMember_id_fk" FOREIGN KEY ("recipientMemberId") REFERENCES "public"."TenantMember"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorUserId_User_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "TenantDbOperation_tenantId_idx" ON "TenantDbOperation" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "TenantDbOperation_kind_idx" ON "TenantDbOperation" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "TenantDbOperation_status_idx" ON "TenantDbOperation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "TenantDbOperation_createdAt_idx" ON "TenantDbOperation" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "NotificationPref_user_tenant_category_idx" ON "NotificationPreference" USING btree ("userId","tenantId","category");--> statement-breakpoint
CREATE INDEX "NotificationPref_userId_idx" ON "NotificationPreference" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Notification_recipient_tenant_read_created_idx" ON "Notification" USING btree ("recipientUserId","tenantId","readAt","createdAt");--> statement-breakpoint
CREATE INDEX "Notification_recipient_created_idx" ON "Notification" USING btree ("recipientUserId","createdAt");--> statement-breakpoint
CREATE INDEX "Notification_tenantId_createdAt_idx" ON "Notification" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "Notification_recipient_dedupe_idx" ON "Notification" USING btree ("recipientUserId","dedupeKey") WHERE "dedupeKey" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PushSub_userId_idx" ON "PushSubscription" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "TenantMember_tenantId_externalId_idx" ON "TenantMember" USING btree ("tenantId","externalId");--> statement-breakpoint
CREATE INDEX "AuditLog_tenantId_action_createdAt_idx" ON "AuditLog" USING btree ("tenantId","action","createdAt");--> statement-breakpoint
CREATE INDEX "AuditLog_rowHash_idx" ON "AuditLog" USING btree ("rowHash");