ALTER TABLE "TenantMember" ADD COLUMN "memberCode" text;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "jobTitle" text;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "invitedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "lastLoginAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "deletedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "TenantInvitation" ADD COLUMN "firstName" text;--> statement-breakpoint
ALTER TABLE "TenantInvitation" ADD COLUMN "lastName" text;--> statement-breakpoint
ALTER TABLE "TenantInvitation" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "TenantInvitation" ADD COLUMN "memberCode" text;--> statement-breakpoint
ALTER TABLE "TenantInvitation" ADD COLUMN "jobTitle" text;--> statement-breakpoint
ALTER TABLE "TenantInvitation" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "TenantInvitation" ADD COLUMN "message" text;--> statement-breakpoint
CREATE INDEX "TenantMember_memberCode_idx" ON "TenantMember" USING btree ("memberCode");--> statement-breakpoint
CREATE INDEX "TenantMember_department_idx" ON "TenantMember" USING btree ("department");--> statement-breakpoint
CREATE INDEX "TenantMember_deletedAt_idx" ON "TenantMember" USING btree ("deletedAt");