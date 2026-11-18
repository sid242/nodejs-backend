CREATE TYPE "public"."FileScanStatus" AS ENUM('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."FileVisibility" AS ENUM('PRIVATE', 'TENANT', 'PUBLIC_LINK');--> statement-breakpoint
CREATE TABLE "FileFolder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"parentId" uuid,
	"name" text NOT NULL,
	"color" text,
	"createdBy" uuid NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "FileShare" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fileId" uuid NOT NULL,
	"tenantId" uuid NOT NULL,
	"tokenHash" text NOT NULL,
	"passwordHash" text,
	"maxDownloads" integer,
	"downloadCount" integer DEFAULT 0 NOT NULL,
	"expiresAt" timestamp (3),
	"createdBy" uuid NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "FileShare_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "FileVersion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fileId" uuid NOT NULL,
	"tenantId" uuid NOT NULL,
	"versionNumber" integer NOT NULL,
	"key" text NOT NULL,
	"size" bigint,
	"checksumSha256" text,
	"createdBy" uuid NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "folderId" uuid;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "checksumSha256" text;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "etag" text;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "durationMs" integer;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "scanStatus" "FileScanStatus" DEFAULT 'CLEAN' NOT NULL;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "scannedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "visibility" "FileVisibility" DEFAULT 'PRIVATE' NOT NULL;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "isDeleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "deletedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "deletedByMemberId" uuid;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "updatedAt" timestamp (3) DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "sourceModule" text;--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "lastAccessedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "File" ADD COLUMN "downloadCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "FileFolder" ADD CONSTRAINT "FileFolder_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FileFolder" ADD CONSTRAINT "FileFolder_parentId_FileFolder_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."FileFolder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FileFolder" ADD CONSTRAINT "FileFolder_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FileShare" ADD CONSTRAINT "FileShare_fileId_File_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."File"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FileShare" ADD CONSTRAINT "FileShare_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FileShare" ADD CONSTRAINT "FileShare_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_fileId_File_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."File"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "FileFolder_tenantId_parentId_idx" ON "FileFolder" USING btree ("tenantId","parentId");--> statement-breakpoint
CREATE INDEX "FileFolder_tenantId_name_idx" ON "FileFolder" USING btree ("tenantId","name");--> statement-breakpoint
CREATE INDEX "FileShare_tenantId_fileId_idx" ON "FileShare" USING btree ("tenantId","fileId");--> statement-breakpoint
CREATE INDEX "FileShare_tokenHash_idx" ON "FileShare" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "FileVersion_tenantId_fileId_idx" ON "FileVersion" USING btree ("tenantId","fileId");--> statement-breakpoint
CREATE INDEX "FileVersion_fileId_version_idx" ON "FileVersion" USING btree ("fileId","versionNumber");--> statement-breakpoint
ALTER TABLE "File" ADD CONSTRAINT "File_folderId_FileFolder_id_fk" FOREIGN KEY ("folderId") REFERENCES "public"."FileFolder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "File_tenantId_folderId_idx" ON "File" USING btree ("tenantId","folderId");--> statement-breakpoint
CREATE INDEX "File_tenantId_isDeleted_idx" ON "File" USING btree ("tenantId","isDeleted");--> statement-breakpoint
ALTER TABLE "FileFolder" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "FileFolder" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "FileFolder";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "FileFolder" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "FileShare" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "FileShare" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "FileShare";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "FileShare" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
ALTER TABLE "FileVersion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "FileVersion" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation_policy" ON "FileVersion";--> statement-breakpoint
CREATE POLICY "tenant_isolation_policy" ON "FileVersion" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR NULLIF(current_setting('app.tenant_id', true), '') IS NULL);
