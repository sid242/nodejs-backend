ALTER TABLE "TenantBranding" ADD COLUMN "primaryDarkColor" text;--> statement-breakpoint
ALTER TABLE "TenantBranding" ADD COLUMN "accentDarkColor" text;--> statement-breakpoint
ALTER TABLE "TenantBranding" ADD COLUMN "fontFamily" text DEFAULT 'Inter' NOT NULL;--> statement-breakpoint
ALTER TABLE "TenantBranding" ADD COLUMN "sidebarTheme" text DEFAULT 'DARK' NOT NULL;