ALTER TABLE "PlatformStaff" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"public"."PlatformStaffStatus";--> statement-breakpoint
ALTER TABLE "PlatformStaff" ALTER COLUMN "status" SET DATA TYPE "public"."PlatformStaffStatus" USING "status"::"public"."PlatformStaffStatus";--> statement-breakpoint
ALTER TABLE "PlatformStaff" ADD COLUMN "userId" uuid;--> statement-breakpoint
ALTER TABLE "PlatformStaff" ADD COLUMN "employeeCode" text;--> statement-breakpoint
ALTER TABLE "PlatformStaff" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "PlatformStaff" ADD COLUMN "jobTitle" text;--> statement-breakpoint
ALTER TABLE "PlatformStaff" ADD COLUMN "invitedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "PlatformStaff" ADD COLUMN "inviteTokenHash" text;--> statement-breakpoint
ALTER TABLE "PlatformStaff" ADD COLUMN "inviteExpiresAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "PlatformStaff" ADD COLUMN "invitationMessage" text;--> statement-breakpoint
ALTER TABLE "PlatformStaff" ADD CONSTRAINT "PlatformStaff_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformStaff_employeeCode_idx" ON "PlatformStaff" USING btree ("employeeCode") WHERE "PlatformStaff"."employeeCode" is not null;--> statement-breakpoint
CREATE INDEX "PlatformStaff_userId_idx" ON "PlatformStaff" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "PlatformStaff_department_idx" ON "PlatformStaff" USING btree ("department");--> statement-breakpoint
CREATE INDEX "PlatformStaff_inviteTokenHash_idx" ON "PlatformStaff" USING btree ("inviteTokenHash");