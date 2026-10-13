CREATE TYPE "public"."MembershipStatus" AS ENUM('ACTIVE', 'INVITED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."TenantStatus" AS ENUM('ACTIVE', 'SUSPENDED', 'TRIALING', 'DEACTIVATED');--> statement-breakpoint
CREATE TYPE "public"."UserStatus" AS ENUM('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');--> statement-breakpoint
CREATE TYPE "public"."VerificationTokenType" AS ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'EMAIL_CHANGE', 'PHONE_OTP', 'MAGIC_LINK');--> statement-breakpoint
CREATE TABLE "VerificationToken" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"tokenHash" text NOT NULL,
	"type" "VerificationTokenType" NOT NULL,
	"target" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"maxAttempts" integer DEFAULT 5 NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"usedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "VerificationToken_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "Session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"refreshTokenHash" text NOT NULL,
	"userAgent" text,
	"ipAddress" text,
	"deviceType" text,
	"isRevoked" boolean DEFAULT false NOT NULL,
	"lastActiveAt" timestamp (3) DEFAULT now() NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "Session_refreshTokenHash_unique" UNIQUE("refreshTokenHash")
);
--> statement-breakpoint
CREATE TABLE "TenantMember" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"status" "MembershipStatus" DEFAULT 'ACTIVE' NOT NULL,
	"joinedAt" timestamp (3) DEFAULT now() NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "TenantStatus" DEFAULT 'ACTIVE' NOT NULL,
	"plan" text DEFAULT 'FREE' NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"deletedAt" timestamp (3),
	CONSTRAINT "Tenant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "Permission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "Permission_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "RolePermission" (
	"roleId" uuid NOT NULL,
	"permissionId" uuid NOT NULL,
	CONSTRAINT "RolePermission_roleId_permissionId_pk" PRIMARY KEY("roleId","permissionId")
);
--> statement-breakpoint
CREATE TABLE "AppRole" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid,
	"name" text NOT NULL,
	"description" text,
	"isSystem" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TenantMemberRole" (
	"memberId" uuid NOT NULL,
	"roleId" uuid NOT NULL,
	CONSTRAINT "TenantMemberRole_memberId_roleId_pk" PRIMARY KEY("memberId","roleId")
);
--> statement-breakpoint
CREATE TABLE "AuditLog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid,
	"userId" uuid,
	"action" text NOT NULL,
	"entityType" text,
	"entityId" text,
	"ipAddress" text,
	"userAgent" text,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "status" "UserStatus" DEFAULT 'PENDING_VERIFICATION' NOT NULL;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "pendingEmail" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "phoneNumber" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "lockedUntil" timestamp (3);--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "lastLoginAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "deletedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "tenantId" uuid;--> statement-breakpoint
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_AppRole_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."AppRole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_Permission_id_fk" FOREIGN KEY ("permissionId") REFERENCES "public"."Permission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AppRole" ADD CONSTRAINT "AppRole_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantMemberRole" ADD CONSTRAINT "TenantMemberRole_memberId_TenantMember_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."TenantMember"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantMemberRole" ADD CONSTRAINT "TenantMemberRole_roleId_AppRole_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."AppRole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "VerificationToken_userId_type_idx" ON "VerificationToken" USING btree ("userId","type");--> statement-breakpoint
CREATE INDEX "VerificationToken_tokenHash_type_idx" ON "VerificationToken" USING btree ("tokenHash","type");--> statement-breakpoint
CREATE INDEX "VerificationToken_expiresAt_idx" ON "VerificationToken" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "Session_userId_isRevoked_idx" ON "Session" USING btree ("userId","isRevoked");--> statement-breakpoint
CREATE INDEX "Session_expiresAt_idx" ON "Session" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "TenantMember_tenantId_userId_unique" ON "TenantMember" USING btree ("tenantId","userId");--> statement-breakpoint
CREATE INDEX "TenantMember_userId_status_idx" ON "TenantMember" USING btree ("userId","status");--> statement-breakpoint
CREATE INDEX "TenantMember_tenantId_status_idx" ON "TenantMember" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "Tenant_status_idx" ON "Tenant" USING btree ("status");--> statement-breakpoint
CREATE INDEX "Tenant_createdAt_idx" ON "Tenant" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "Tenant_deletedAt_idx" ON "Tenant" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "Permission_category_idx" ON "Permission" USING btree ("category");--> statement-breakpoint
CREATE INDEX "RolePermission_roleId_idx" ON "RolePermission" USING btree ("roleId");--> statement-breakpoint
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission" USING btree ("permissionId");--> statement-breakpoint
CREATE INDEX "AppRole_tenantId_idx" ON "AppRole" USING btree ("tenantId");--> statement-breakpoint
CREATE UNIQUE INDEX "AppRole_tenantId_name_idx" ON "AppRole" USING btree ("tenantId","name");--> statement-breakpoint
CREATE INDEX "TenantMemberRole_memberId_idx" ON "TenantMemberRole" USING btree ("memberId");--> statement-breakpoint
CREATE INDEX "TenantMemberRole_roleId_idx" ON "TenantMemberRole" USING btree ("roleId");--> statement-breakpoint
CREATE INDEX "AuditLog_tenantId_action_idx" ON "AuditLog" USING btree ("tenantId","action");--> statement-breakpoint
CREATE INDEX "AuditLog_userId_action_idx" ON "AuditLog" USING btree ("userId","action");--> statement-breakpoint
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" USING btree ("createdAt");--> statement-breakpoint
ALTER TABLE "File" ADD CONSTRAINT "File_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "User_status_idx" ON "User" USING btree ("status");--> statement-breakpoint
CREATE INDEX "User_createdAt_idx" ON "User" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "User_deletedAt_idx" ON "User" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "File_tenantId_createdAt_idx" ON "File" USING btree ("tenantId","createdAt");