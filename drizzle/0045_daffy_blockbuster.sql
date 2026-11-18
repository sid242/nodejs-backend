CREATE TABLE "UserLoginEvent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid,
	"tenantId" uuid,
	"result" text NOT NULL,
	"method" text NOT NULL,
	"ip" text,
	"userAgent" text,
	"country" text,
	"city" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "firstName" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "lastName" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "locale" text DEFAULT 'en';--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "timezone" text DEFAULT 'UTC';--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "dateFormat" text DEFAULT 'YYYY-MM-DD';--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "lastPasswordResetAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "termsVersion" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "marketingOptIn" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "lastSeenAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Session" ADD COLUMN "familyId" uuid;--> statement-breakpoint
ALTER TABLE "Session" ADD COLUMN "rotatedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Session" ADD COLUMN "replacedBy" uuid;--> statement-breakpoint
ALTER TABLE "Session" ADD COLUMN "deviceName" text;--> statement-breakpoint
ALTER TABLE "Session" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "Session" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "UserLoginEvent" ADD CONSTRAINT "UserLoginEvent_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserLoginEvent" ADD CONSTRAINT "UserLoginEvent_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "UserLoginEvent_userId_createdAt_idx" ON "UserLoginEvent" USING btree ("userId","createdAt" desc);--> statement-breakpoint
CREATE INDEX "UserLoginEvent_tenantId_createdAt_idx" ON "UserLoginEvent" USING btree ("tenantId","createdAt" desc);--> statement-breakpoint
CREATE INDEX "Session_familyId_idx" ON "Session" USING btree ("familyId");