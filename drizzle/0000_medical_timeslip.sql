CREATE TYPE "public"."FileStatus" AS ENUM('PENDING', 'UPLOADED');--> statement-breakpoint
CREATE TYPE "public"."Role" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TABLE "File" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"filename" text NOT NULL,
	"contentType" text NOT NULL,
	"size" integer,
	"status" "FileStatus" DEFAULT 'PENDING' NOT NULL,
	"ownerId" uuid NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "File_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"passwordHash" text NOT NULL,
	"name" text NOT NULL,
	"role" "Role" DEFAULT 'USER' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "User_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "File" ADD CONSTRAINT "File_ownerId_User_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "File_ownerId_createdAt_idx" ON "File" USING btree ("ownerId","createdAt");--> statement-breakpoint
CREATE INDEX "File_status_createdAt_idx" ON "File" USING btree ("status","createdAt");