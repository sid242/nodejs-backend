CREATE TYPE "public"."UserGroupScope" AS ENUM('PLATFORM', 'TENANT');--> statement-breakpoint
CREATE TYPE "public"."UserGroupStatus" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "UserGroupMember" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"groupId" uuid NOT NULL,
	"userId" uuid,
	"staffId" uuid,
	"tenantId" uuid,
	"addedBy" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserGroup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"scope" "UserGroupScope" DEFAULT 'TENANT' NOT NULL,
	"tenantId" uuid,
	"status" "UserGroupStatus" DEFAULT 'ACTIVE' NOT NULL,
	"createdBy" uuid,
	"updatedBy" uuid,
	"archivedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "UserGroupMember" ADD CONSTRAINT "UserGroupMember_groupId_UserGroup_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."UserGroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserGroupMember" ADD CONSTRAINT "UserGroupMember_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserGroupMember" ADD CONSTRAINT "UserGroupMember_staffId_PlatformStaff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserGroupMember" ADD CONSTRAINT "UserGroupMember_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserGroup" ADD CONSTRAINT "UserGroup_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "UserGroupMember_group_user_unique" ON "UserGroupMember" USING btree ("groupId","userId") WHERE "UserGroupMember"."userId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "UserGroupMember_group_staff_unique" ON "UserGroupMember" USING btree ("groupId","staffId") WHERE "UserGroupMember"."staffId" is not null;--> statement-breakpoint
CREATE INDEX "UserGroupMember_groupId_idx" ON "UserGroupMember" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "UserGroupMember_userId_idx" ON "UserGroupMember" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "UserGroupMember_staffId_idx" ON "UserGroupMember" USING btree ("staffId");--> statement-breakpoint
CREATE INDEX "UserGroupMember_tenantId_idx" ON "UserGroupMember" USING btree ("tenantId");--> statement-breakpoint
CREATE UNIQUE INDEX "UserGroup_platform_slug_unique" ON "UserGroup" USING btree ("slug") WHERE ("scope" = 'PLATFORM' and "archivedAt" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "UserGroup_tenant_slug_unique" ON "UserGroup" USING btree ("tenantId","slug") WHERE ("scope" = 'TENANT' and "archivedAt" is null);--> statement-breakpoint
CREATE INDEX "UserGroup_scope_status_idx" ON "UserGroup" USING btree ("scope","status");--> statement-breakpoint
CREATE INDEX "UserGroup_tenantId_status_idx" ON "UserGroup" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "UserGroup_tenantId_createdAt_idx" ON "UserGroup" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE INDEX "UserGroup_scope_createdAt_idx" ON "UserGroup" USING btree ("scope","createdAt");