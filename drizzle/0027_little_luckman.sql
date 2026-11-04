CREATE TABLE "UserGroupRole" (
	"groupId" uuid NOT NULL,
	"roleId" uuid NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "UserGroupRole_groupId_roleId_pk" PRIMARY KEY("groupId","roleId")
);
--> statement-breakpoint
ALTER TABLE "Permission" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "Permission" ADD COLUMN "scope" text DEFAULT 'TENANT' NOT NULL;--> statement-breakpoint
ALTER TABLE "Permission" ADD COLUMN "resource" text;--> statement-breakpoint
ALTER TABLE "Permission" ADD COLUMN "riskLevel" text DEFAULT 'LOW' NOT NULL;--> statement-breakpoint
ALTER TABLE "Permission" ADD COLUMN "isSystem" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "Permission" ADD COLUMN "isAssignable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "AppRole" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "AppRole" ADD COLUMN "scope" text DEFAULT 'TENANT' NOT NULL;--> statement-breakpoint
ALTER TABLE "AppRole" ADD COLUMN "isActive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "UserGroupRole" ADD CONSTRAINT "UserGroupRole_groupId_UserGroup_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."UserGroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserGroupRole" ADD CONSTRAINT "UserGroupRole_roleId_AppRole_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."AppRole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "UserGroupRole_roleId_idx" ON "UserGroupRole" USING btree ("roleId");--> statement-breakpoint
CREATE INDEX "UserGroupRole_groupId_idx" ON "UserGroupRole" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "Permission_scope_idx" ON "Permission" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "Permission_resource_idx" ON "Permission" USING btree ("resource");--> statement-breakpoint
CREATE INDEX "AppRole_scope_idx" ON "AppRole" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "AppRole_isActive_idx" ON "AppRole" USING btree ("isActive");--> statement-breakpoint
CREATE UNIQUE INDEX "AppRole_tenant_code_unique" ON "AppRole" USING btree ("tenantId","code") WHERE "AppRole"."tenantId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "AppRole_system_code_unique" ON "AppRole" USING btree ("code") WHERE "AppRole"."tenantId" is null;