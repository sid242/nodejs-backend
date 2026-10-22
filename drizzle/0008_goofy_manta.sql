CREATE TABLE "PlatformPermission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PlatformPermission_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "PlatformRolePermission" (
	"roleId" uuid NOT NULL,
	"permissionId" uuid NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PlatformRolePermission_roleId_permissionId_pk" PRIMARY KEY("roleId","permissionId")
);
--> statement-breakpoint
CREATE TABLE "PlatformRole" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"isSystem" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PlatformRole_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "PlatformStaff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"passwordHash" text NOT NULL,
	"displayName" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"roleId" uuid NOT NULL,
	"lastLoginAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PlatformStaff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "PlatformAuditLog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actorStaffId" uuid,
	"action" text NOT NULL,
	"targetType" text NOT NULL,
	"targetId" text,
	"tenantId" uuid,
	"metadata" jsonb,
	"requestId" text,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PlatformSupportSession" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staffId" uuid NOT NULL,
	"tenantId" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"startedAt" timestamp (3) DEFAULT now() NOT NULL,
	"endedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PlatformUserGroupMember" (
	"groupId" uuid NOT NULL,
	"staffId" uuid NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PlatformUserGroupMember_groupId_staffId_pk" PRIMARY KEY("groupId","staffId")
);
--> statement-breakpoint
CREATE TABLE "PlatformUserGroupRole" (
	"groupId" uuid NOT NULL,
	"roleId" uuid NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PlatformUserGroupRole_groupId_roleId_pk" PRIMARY KEY("groupId","roleId")
);
--> statement-breakpoint
CREATE TABLE "PlatformUserGroup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PlatformUserGroup_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "databaseMode" text DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "databaseKey" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "databaseSecretRef" text;--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "schemaVersion" text DEFAULT '1.0.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "PlatformRolePermission" ADD CONSTRAINT "PlatformRolePermission_roleId_PlatformRole_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."PlatformRole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformRolePermission" ADD CONSTRAINT "PlatformRolePermission_permissionId_PlatformPermission_id_fk" FOREIGN KEY ("permissionId") REFERENCES "public"."PlatformPermission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformStaff" ADD CONSTRAINT "PlatformStaff_roleId_PlatformRole_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."PlatformRole"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_actorStaffId_PlatformStaff_id_fk" FOREIGN KEY ("actorStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformSupportSession" ADD CONSTRAINT "PlatformSupportSession_staffId_PlatformStaff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformUserGroupMember" ADD CONSTRAINT "PlatformUserGroupMember_groupId_PlatformUserGroup_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."PlatformUserGroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformUserGroupMember" ADD CONSTRAINT "PlatformUserGroupMember_staffId_PlatformStaff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformUserGroupRole" ADD CONSTRAINT "PlatformUserGroupRole_groupId_PlatformUserGroup_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."PlatformUserGroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformUserGroupRole" ADD CONSTRAINT "PlatformUserGroupRole_roleId_PlatformRole_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."PlatformRole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformPermission_key_idx" ON "PlatformPermission" USING btree ("key");--> statement-breakpoint
CREATE INDEX "PlatformPermission_resource_idx" ON "PlatformPermission" USING btree ("resource");--> statement-breakpoint
CREATE INDEX "PlatformRolePermission_roleId_idx" ON "PlatformRolePermission" USING btree ("roleId");--> statement-breakpoint
CREATE INDEX "PlatformRolePermission_permissionId_idx" ON "PlatformRolePermission" USING btree ("permissionId");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformRole_key_idx" ON "PlatformRole" USING btree ("key");--> statement-breakpoint
CREATE INDEX "PlatformRole_isActive_idx" ON "PlatformRole" USING btree ("isActive");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformStaff_email_idx" ON "PlatformStaff" USING btree ("email");--> statement-breakpoint
CREATE INDEX "PlatformStaff_roleId_idx" ON "PlatformStaff" USING btree ("roleId");--> statement-breakpoint
CREATE INDEX "PlatformStaff_status_idx" ON "PlatformStaff" USING btree ("status");--> statement-breakpoint
CREATE INDEX "PlatformAuditLog_actorStaffId_idx" ON "PlatformAuditLog" USING btree ("actorStaffId");--> statement-breakpoint
CREATE INDEX "PlatformAuditLog_action_idx" ON "PlatformAuditLog" USING btree ("action");--> statement-breakpoint
CREATE INDEX "PlatformAuditLog_targetType_idx" ON "PlatformAuditLog" USING btree ("targetType");--> statement-breakpoint
CREATE INDEX "PlatformAuditLog_tenantId_idx" ON "PlatformAuditLog" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "PlatformSupportSession_staffId_idx" ON "PlatformSupportSession" USING btree ("staffId");--> statement-breakpoint
CREATE INDEX "PlatformSupportSession_tenantId_idx" ON "PlatformSupportSession" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "PlatformSupportSession_status_idx" ON "PlatformSupportSession" USING btree ("status");--> statement-breakpoint
CREATE INDEX "PlatformUserGroupMember_staffId_idx" ON "PlatformUserGroupMember" USING btree ("staffId");--> statement-breakpoint
CREATE INDEX "PlatformUserGroupRole_roleId_idx" ON "PlatformUserGroupRole" USING btree ("roleId");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformUserGroup_key_idx" ON "PlatformUserGroup" USING btree ("key");--> statement-breakpoint
CREATE INDEX "Tenant_databaseMode_idx" ON "Tenant" USING btree ("databaseMode");