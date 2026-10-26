ALTER TYPE "public"."VerificationTokenType" ADD VALUE 'TWO_FACTOR_CHALLENGE';--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "twoFactorSecret" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "twoFactorEnabledAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "twoFactorRecoveryCodes" json;