CREATE TYPE "public"."policy_effect" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'proposal', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "Policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid,
	"name" text NOT NULL,
	"description" text,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"effect" "policy_effect" DEFAULT 'allow' NOT NULL,
	"conditions" jsonb NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"createdBy" uuid,
	"updatedBy" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RolePolicy" (
	"roleId" uuid NOT NULL,
	"policyId" uuid NOT NULL,
	"tenantId" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "RolePolicy_roleId_policyId_pk" PRIMARY KEY("roleId","policyId")
);
--> statement-breakpoint
CREATE TABLE "Lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company" text,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"departmentId" text,
	"regionId" text,
	"assignedMemberId" uuid,
	"isConfidential" boolean DEFAULT false NOT NULL,
	"notes" text,
	"createdBy" uuid,
	"updatedBy" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_updatedBy_User_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RolePolicy" ADD CONSTRAINT "RolePolicy_roleId_AppRole_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."AppRole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RolePolicy" ADD CONSTRAINT "RolePolicy_policyId_Policy_id_fk" FOREIGN KEY ("policyId") REFERENCES "public"."Policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RolePolicy" ADD CONSTRAINT "RolePolicy_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedMemberId_TenantMember_id_fk" FOREIGN KEY ("assignedMemberId") REFERENCES "public"."TenantMember"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_updatedBy_User_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Policy_tenantId_resource_action_idx" ON "Policy" USING btree ("tenantId","resource","action");--> statement-breakpoint
CREATE INDEX "Policy_tenantId_isActive_idx" ON "Policy" USING btree ("tenantId","isActive");--> statement-breakpoint
CREATE UNIQUE INDEX "Policy_tenant_name_unique" ON "Policy" USING btree ("tenantId","name") WHERE "Policy"."tenantId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "Policy_platform_name_unique" ON "Policy" USING btree ("name") WHERE "Policy"."tenantId" is null;--> statement-breakpoint
CREATE INDEX "RolePolicy_roleId_idx" ON "RolePolicy" USING btree ("roleId");--> statement-breakpoint
CREATE INDEX "RolePolicy_policyId_idx" ON "RolePolicy" USING btree ("policyId");--> statement-breakpoint
CREATE INDEX "RolePolicy_tenantId_idx" ON "RolePolicy" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "Lead_tenantId_status_idx" ON "Lead" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "Lead_tenantId_assignedMemberId_idx" ON "Lead" USING btree ("tenantId","assignedMemberId");--> statement-breakpoint
CREATE INDEX "Lead_tenantId_departmentId_idx" ON "Lead" USING btree ("tenantId","departmentId");--> statement-breakpoint
CREATE INDEX "Lead_tenantId_createdAt_idx" ON "Lead" USING btree ("tenantId","createdAt");