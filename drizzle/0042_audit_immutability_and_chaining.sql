ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "prevHash" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "rowHash" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorEmail" text;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorName" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_action_createdAt_idx" ON "AuditLog" ("tenantId", "action", "createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AuditLog_rowHash_idx" ON "AuditLog" ("rowHash");--> statement-breakpoint

ALTER TABLE "PlatformAuditLog" ADD COLUMN IF NOT EXISTS "prevHash" text;--> statement-breakpoint
ALTER TABLE "PlatformAuditLog" ADD COLUMN IF NOT EXISTS "rowHash" text;--> statement-breakpoint
ALTER TABLE "PlatformAuditLog" ADD COLUMN IF NOT EXISTS "actorEmail" text;--> statement-breakpoint
ALTER TABLE "PlatformAuditLog" ADD COLUMN IF NOT EXISTS "actorName" text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "AuditRetentionRun" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid REFERENCES "Tenant"("id") ON DELETE cascade,
	"cutoffDate" timestamp(3) with time zone NOT NULL,
	"rowsArchived" integer DEFAULT 0 NOT NULL,
	"rowsPurged" integer DEFAULT 0 NOT NULL,
	"archiveS3Key" text,
	"archiveSha256" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"startedAt" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp(3) with time zone
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only and immutable; updates and direct edits are strictly prohibited.';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON "AuditLog";--> statement-breakpoint
CREATE TRIGGER trg_audit_log_no_update BEFORE UPDATE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_platform_audit_log_no_update ON "PlatformAuditLog";--> statement-breakpoint
CREATE TRIGGER trg_platform_audit_log_no_update BEFORE UPDATE ON "PlatformAuditLog" FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION check_audit_log_purge_authorized() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_audit_purge', true) != 'true' THEN
    RAISE EXCEPTION 'Unauthorized deletion on AuditLog: direct DELETE is strictly forbidden outside authorized retention archive runs.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_audit_log_purge_guard ON "AuditLog";--> statement-breakpoint
CREATE TRIGGER trg_audit_log_purge_guard BEFORE DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION check_audit_log_purge_authorized();--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_platform_audit_log_purge_guard ON "PlatformAuditLog";--> statement-breakpoint
CREATE TRIGGER trg_platform_audit_log_purge_guard BEFORE DELETE ON "PlatformAuditLog" FOR EACH ROW EXECUTE FUNCTION check_audit_log_purge_authorized();
