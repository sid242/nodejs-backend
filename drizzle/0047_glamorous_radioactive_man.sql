UPDATE "User" SET "lastName" = '' WHERE "lastName" IS NULL;--> statement-breakpoint
ALTER TABLE "User" ALTER COLUMN "lastName" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "User" ALTER COLUMN "lastName" SET NOT NULL;