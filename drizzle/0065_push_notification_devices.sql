CREATE TYPE "public"."PushChannel" AS ENUM('webpush', 'fcm', 'apns');--> statement-breakpoint
ALTER TABLE "PushSubscription" DROP CONSTRAINT "PushSubscription_endpoint_unique";--> statement-breakpoint
ALTER TABLE "PushSubscription" ALTER COLUMN "userId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "PushSubscription" ALTER COLUMN "endpoint" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "PushSubscription" ALTER COLUMN "p256dh" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "PushSubscription" ALTER COLUMN "auth" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD COLUMN "staffId" uuid;--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD COLUMN "channel" "PushChannel" DEFAULT 'webpush' NOT NULL;--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD COLUMN "platform" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD COLUMN "appVersion" text;--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD COLUMN "failureCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD COLUMN "disabledAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_staffId_PlatformStaff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "PushSub_staffId_idx" ON "PushSubscription" USING btree ("staffId");--> statement-breakpoint
CREATE UNIQUE INDEX "PushSub_endpoint_uidx" ON "PushSubscription" USING btree ("endpoint") WHERE "endpoint" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "PushSub_channel_token_uidx" ON "PushSubscription" USING btree ("channel","token") WHERE "token" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSub_owner_xor_chk" CHECK ((("userId" IS NOT NULL AND "staffId" IS NULL) OR ("userId" IS NULL AND "staffId" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSub_channel_creds_chk" CHECK ((("channel" = 'webpush' AND "endpoint" IS NOT NULL AND "p256dh" IS NOT NULL AND "auth" IS NOT NULL) OR ("channel" IN ('fcm', 'apns') AND "token" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSub_failure_count_chk" CHECK ("failureCount" >= 0);