CREATE TYPE "public"."ActorType" AS ENUM('USER', 'PLATFORM_STAFF', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."CustomDomainStatus" AS ENUM('PENDING', 'VERIFIED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."InvitationStatus" AS ENUM('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."PlatformStaffStatus" AS ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');--> statement-breakpoint
CREATE TYPE "public"."SubscriptionStatus" AS ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."SupportSessionMode" AS ENUM('TENANT_SCOPED', 'AS_MEMBER');--> statement-breakpoint
CREATE TYPE "public"."SupportSessionScope" AS ENUM('READ_ONLY', 'FULL');--> statement-breakpoint
CREATE TYPE "public"."SupportSessionStatus" AS ENUM('ACTIVE', 'EXPIRED', 'TERMINATED');--> statement-breakpoint
CREATE TYPE "public"."TenantDatabaseMode" AS ENUM('shared', 'dedicated');--> statement-breakpoint
ALTER TYPE "public"."VerificationTokenType" ADD VALUE 'PLATFORM_STAFF_INVITE';--> statement-breakpoint
CREATE TABLE "TenantInvitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"email" text NOT NULL,
	"roleId" uuid NOT NULL,
	"invitedByUserId" uuid,
	"invitedByStaffId" uuid,
	"tokenHash" text NOT NULL,
	"status" "InvitationStatus" DEFAULT 'PENDING' NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"acceptedAt" timestamp (3),
	"acceptedByUserId" uuid,
	"revokedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "TenantInvitation_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "PlanModule" (
	"planId" uuid NOT NULL,
	"moduleId" uuid NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PlanModule_planId_moduleId_pk" PRIMARY KEY("planId","moduleId")
);
--> statement-breakpoint
CREATE TABLE "SubscriptionEvent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscriptionId" uuid NOT NULL,
	"tenantId" uuid NOT NULL,
	"type" text NOT NULL,
	"fromPlanId" uuid,
	"toPlanId" uuid,
	"actorType" "ActorType" DEFAULT 'USER' NOT NULL,
	"actorId" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PlanEntitlement" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "PlanEntitlement" CASCADE;--> statement-breakpoint
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_planId_Plan_id_fk";
--> statement-breakpoint
DROP INDEX "PlatformSupportSession_staffId_idx";--> statement-breakpoint
DROP INDEX "PlatformSupportSession_tenantId_idx";--> statement-breakpoint
DROP INDEX "PlatformSupportSession_status_idx";--> statement-breakpoint
DROP INDEX "Subscription_tenantId_unique";--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"public"."SupportSessionStatus";--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ALTER COLUMN "status" SET DATA TYPE "public"."SupportSessionStatus" USING "status"::"public"."SupportSessionStatus";--> statement-breakpoint
ALTER TABLE "Plan" ALTER COLUMN "currency" SET DEFAULT 'INR';--> statement-breakpoint
ALTER TABLE "Subscription" ALTER COLUMN "status" SET DEFAULT 'TRIALING'::"public"."SubscriptionStatus";--> statement-breakpoint
ALTER TABLE "Subscription" ALTER COLUMN "status" SET DATA TYPE "public"."SubscriptionStatus" USING "status"::"public"."SubscriptionStatus";--> statement-breakpoint
ALTER TABLE "Subscription" ALTER COLUMN "provider" SET DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "allowSupportAccess" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "actorType" "ActorType" DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "actorStaffId" uuid;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN "supportSessionId" uuid;--> statement-breakpoint
ALTER TABLE "PlatformAuditLog" ADD COLUMN "supportSessionId" uuid;--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD COLUMN "mode" "SupportSessionMode" DEFAULT 'TENANT_SCOPED' NOT NULL;--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD COLUMN "scope" "SupportSessionScope" DEFAULT 'READ_ONLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD COLUMN "targetMemberId" uuid;--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD COLUMN "ticketRef" text;--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD COLUMN "endedByStaffId" uuid;--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD COLUMN "endOutcome" text;--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "priceMonthlyMinor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "priceYearlyMinor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "trialDays" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "limits" jsonb DEFAULT '{"maxMembers": 5, "maxStorageBytes": 1073741824, "maxCustomRoles": 2}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "sortOrder" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_roleId_AppRole_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."AppRole"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_invitedByUserId_User_id_fk" FOREIGN KEY ("invitedByUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_invitedByStaffId_PlatformStaff_id_fk" FOREIGN KEY ("invitedByStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_acceptedByUserId_User_id_fk" FOREIGN KEY ("acceptedByUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlanModule" ADD CONSTRAINT "PlanModule_planId_Plan_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlanModule" ADD CONSTRAINT "PlanModule_moduleId_AppModule_id_fk" FOREIGN KEY ("moduleId") REFERENCES "public"."AppModule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "TenantInvitation_tenantId_email_pending_unique" ON "TenantInvitation" USING btree ("tenantId",lower("email")) WHERE "TenantInvitation"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "TenantInvitation_tenantId_status_idx" ON "TenantInvitation" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "TenantInvitation_email_idx" ON "TenantInvitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "TenantInvitation_tokenHash_idx" ON "TenantInvitation" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "PlanModule_planId_idx" ON "PlanModule" USING btree ("planId");--> statement-breakpoint
CREATE INDEX "PlanModule_moduleId_idx" ON "PlanModule" USING btree ("moduleId");--> statement-breakpoint
CREATE INDEX "SubscriptionEvent_tenantId_idx" ON "SubscriptionEvent" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "SubscriptionEvent_subscriptionId_idx" ON "SubscriptionEvent" USING btree ("subscriptionId");--> statement-breakpoint
CREATE INDEX "SubscriptionEvent_createdAt_idx" ON "SubscriptionEvent" USING btree ("createdAt");--> statement-breakpoint
UPDATE "PlatformAuditLog" SET "tenantId" = NULL WHERE "tenantId" IS NOT NULL AND "tenantId" NOT IN (SELECT "id" FROM "Tenant");--> statement-breakpoint
DELETE FROM "PlatformSupportSession" WHERE "tenantId" NOT IN (SELECT "id" FROM "Tenant");--> statement-breakpoint
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD CONSTRAINT "PlatformSupportSession_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD CONSTRAINT "PlatformSupportSession_targetUserId_User_id_fk" FOREIGN KEY ("targetUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD CONSTRAINT "PlatformSupportSession_targetMemberId_TenantMember_id_fk" FOREIGN KEY ("targetMemberId") REFERENCES "public"."TenantMember"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD CONSTRAINT "PlatformSupportSession_endedByStaffId_PlatformStaff_id_fk" FOREIGN KEY ("endedByStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_Plan_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AuditLog_tenantId_supportSessionId_idx" ON "AuditLog" USING btree ("tenantId","supportSessionId");--> statement-breakpoint
CREATE INDEX "PlatformAuditLog_supportSessionId_idx" ON "PlatformAuditLog" USING btree ("supportSessionId");--> statement-breakpoint
CREATE INDEX "PlatformSupportSession_staffId_status_idx" ON "PlatformSupportSession" USING btree ("staffId","status");--> statement-breakpoint
CREATE INDEX "PlatformSupportSession_tenantId_status_idx" ON "PlatformSupportSession" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "PlatformSupportSession_targetMemberId_idx" ON "PlatformSupportSession" USING btree ("targetMemberId");--> statement-breakpoint
CREATE INDEX "Plan_sortOrder_idx" ON "Plan" USING btree ("sortOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "Subscription_tenantId_active_unique" ON "Subscription" USING btree ("tenantId") WHERE "Subscription"."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE');--> statement-breakpoint
CREATE INDEX "Subscription_tenantId_idx" ON "Subscription" USING btree ("tenantId");--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" DROP COLUMN "impersonatedRole";--> statement-breakpoint
ALTER TABLE "Plan" DROP COLUMN "priceCents";--> statement-breakpoint
ALTER TABLE "Plan" DROP COLUMN "billingInterval";--> statement-breakpoint
ALTER TABLE "Plan" DROP COLUMN "metadata";--> statement-breakpoint
ALTER TABLE "Subscription" DROP COLUMN "seatCount";--> statement-breakpoint
ALTER TABLE "Subscription" DROP COLUMN "canceledAt";