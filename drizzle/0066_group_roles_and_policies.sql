CREATE TABLE "GroupPolicy" (
	"groupId" uuid NOT NULL,
	"policyId" uuid NOT NULL,
	"tenantId" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "GroupPolicy_groupId_policyId_pk" PRIMARY KEY("groupId","policyId")
);
--> statement-breakpoint
CREATE TABLE "UserGroupPlatformRole" (
	"groupId" uuid NOT NULL,
	"roleId" uuid NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "UserGroupPlatformRole_groupId_roleId_pk" PRIMARY KEY("groupId","roleId")
);
--> statement-breakpoint
ALTER TABLE "GroupPolicy" ADD CONSTRAINT "GroupPolicy_groupId_UserGroup_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."UserGroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GroupPolicy" ADD CONSTRAINT "GroupPolicy_policyId_Policy_id_fk" FOREIGN KEY ("policyId") REFERENCES "public"."Policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GroupPolicy" ADD CONSTRAINT "GroupPolicy_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserGroupPlatformRole" ADD CONSTRAINT "UserGroupPlatformRole_groupId_UserGroup_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."UserGroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserGroupPlatformRole" ADD CONSTRAINT "UserGroupPlatformRole_roleId_PlatformRole_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."PlatformRole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "GroupPolicy_groupId_idx" ON "GroupPolicy" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "GroupPolicy_policyId_idx" ON "GroupPolicy" USING btree ("policyId");--> statement-breakpoint
CREATE INDEX "GroupPolicy_tenantId_idx" ON "GroupPolicy" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "UserGroupPlatformRole_groupId_idx" ON "UserGroupPlatformRole" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "UserGroupPlatformRole_roleId_idx" ON "UserGroupPlatformRole" USING btree ("roleId");