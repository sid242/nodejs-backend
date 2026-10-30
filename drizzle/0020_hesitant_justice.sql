ALTER TABLE "TenantBranding" ADD COLUMN "authHeadline" text;--> statement-breakpoint
ALTER TABLE "TenantBranding" ADD COLUMN "authSubtitle" text;--> statement-breakpoint
ALTER TABLE "TenantBranding" ADD COLUMN "authCoverUrl" text;--> statement-breakpoint
ALTER TABLE "TenantBranding" ADD COLUMN "authLayout" text DEFAULT 'SPLIT' NOT NULL;