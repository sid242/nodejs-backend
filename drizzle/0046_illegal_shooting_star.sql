ALTER TABLE "User" ALTER COLUMN "firstName" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "User" ALTER COLUMN "firstName" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "name";