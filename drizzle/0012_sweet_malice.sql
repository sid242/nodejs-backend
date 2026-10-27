ALTER TABLE "PlatformStaff" ADD COLUMN "twoFactorSecret" text;--> statement-breakpoint
ALTER TABLE "PlatformStaff" ADD COLUMN "twoFactorEnabledAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "PlatformStaff" ADD COLUMN "twoFactorRecoveryCodes" json;