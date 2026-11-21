CREATE TABLE "FeedbackItem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid,
	"userId" uuid,
	"rating" integer NOT NULL,
	"category" text DEFAULT 'GENERAL' NOT NULL,
	"comment" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OnboardingProgress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"userId" uuid,
	"stepKey" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"completedAt" timestamp (3),
	"data" jsonb DEFAULT '{}'::jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SupportTicketMessage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticketId" uuid NOT NULL,
	"tenantId" uuid NOT NULL,
	"senderType" text DEFAULT 'USER' NOT NULL,
	"senderId" uuid NOT NULL,
	"senderName" text,
	"message" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"isInternal" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SupportTicket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"ticketRef" text NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"category" text DEFAULT 'GENERAL' NOT NULL,
	"assigneeStaffId" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"resolvedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "FeedbackItem" ADD CONSTRAINT "FeedbackItem_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FeedbackItem" ADD CONSTRAINT "FeedbackItem_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "OnboardingProgress" ADD CONSTRAINT "OnboardingProgress_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "OnboardingProgress" ADD CONSTRAINT "OnboardingProgress_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_ticketId_SupportTicket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."SupportTicket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assigneeStaffId_PlatformStaff_id_fk" FOREIGN KEY ("assigneeStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "FeedbackItem_tenantId_createdAt_idx" ON "FeedbackItem" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE INDEX "FeedbackItem_rating_idx" ON "FeedbackItem" USING btree ("rating");--> statement-breakpoint
CREATE UNIQUE INDEX "OnboardingProgress_tenantId_stepKey_key" ON "OnboardingProgress" USING btree ("tenantId","stepKey");--> statement-breakpoint
CREATE INDEX "OnboardingProgress_tenantId_status_idx" ON "OnboardingProgress" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage" USING btree ("ticketId","createdAt");--> statement-breakpoint
CREATE INDEX "SupportTicketMessage_tenantId_idx" ON "SupportTicketMessage" USING btree ("tenantId");--> statement-breakpoint
CREATE UNIQUE INDEX "SupportTicket_ticketRef_key" ON "SupportTicket" USING btree ("ticketRef");--> statement-breakpoint
CREATE INDEX "SupportTicket_tenantId_status_idx" ON "SupportTicket" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "SupportTicket_userId_idx" ON "SupportTicket" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "SupportTicket_assigneeStaffId_idx" ON "SupportTicket" USING btree ("assigneeStaffId");