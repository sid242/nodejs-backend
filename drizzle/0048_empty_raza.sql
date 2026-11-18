ALTER TABLE "TenantMember" ADD COLUMN "managerMemberId" uuid;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "employmentType" text;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "startDate" timestamp (3);--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "endDate" timestamp (3);--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "workEmail" text;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "avatarUrl" text;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "offboardedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "offboardedByMemberId" uuid;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "reassignedToMemberId" uuid;