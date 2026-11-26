CREATE TYPE "public"."WhatsAppAccountStatus" AS ENUM('NOT_CONNECTED', 'ONBOARDING', 'PENDING_VERIFICATION', 'CONNECTED', 'RESTRICTED', 'DISCONNECTED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."WhatsAppCampaignRecipientStatus" AS ENUM('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SUPPRESSED');--> statement-breakpoint
CREATE TYPE "public"."WhatsAppCampaignStatus" AS ENUM('DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'PAUSED', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."WhatsAppConsentPurpose" AS ENUM('AUTHENTICATION', 'TRANSACTIONAL', 'MARKETING');--> statement-breakpoint
CREATE TYPE "public"."WhatsAppConsentStatus" AS ENUM('OPTED_IN', 'OPTED_OUT');--> statement-breakpoint
CREATE TYPE "public"."WhatsAppConversationStatus" AS ENUM('OPEN', 'PENDING', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."WhatsAppMessageDirection" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TYPE "public"."WhatsAppMessageInternalStatus" AS ENUM('QUEUED', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."WhatsAppMessageType" AS ENUM('TEMPLATE', 'TEXT', 'IMAGE', 'DOCUMENT', 'VIDEO', 'AUDIO', 'LOCATION', 'INTERACTIVE');--> statement-breakpoint
CREATE TYPE "public"."WhatsAppOtpPurpose" AS ENUM('LOGIN', 'SIGNUP', 'PHONE_VERIFICATION', 'PASSWORD_RESET', 'SENSITIVE_ACTION');--> statement-breakpoint
CREATE TYPE "public"."WhatsAppScheduledMessageStatus" AS ENUM('SCHEDULED', 'PROCESSING', 'SENT', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."WhatsAppTemplateCategory" AS ENUM('AUTHENTICATION', 'UTILITY', 'MARKETING');--> statement-breakpoint
CREATE TYPE "public"."WhatsAppTemplateStatus" AS ENUM('DRAFT', 'SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'DELETED');--> statement-breakpoint
CREATE TABLE "WhatsAppOtpChallenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phoneNumber" text NOT NULL,
	"purpose" "WhatsAppOtpPurpose" NOT NULL,
	"codeHash" text NOT NULL,
	"expiresAt" timestamp (3) NOT NULL,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"maxAttempts" integer DEFAULT 5 NOT NULL,
	"consumedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PlatformWhatsAppAccountRegistry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"wabaId" text NOT NULL,
	"phoneNumberId" text NOT NULL,
	"databaseRoutingKey" text,
	"connectionStatus" "WhatsAppAccountStatus" DEFAULT 'CONNECTED' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WhatsAppBusinessAccount" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"wabaId" text NOT NULL,
	"businessId" text,
	"displayName" text NOT NULL,
	"encryptedAccessToken" text NOT NULL,
	"tokenKeyVersion" text DEFAULT 'default' NOT NULL,
	"tokenExpiresAt" timestamp (3),
	"connectionStatus" "WhatsAppAccountStatus" DEFAULT 'NOT_CONNECTED' NOT NULL,
	"connectedBy" uuid,
	"connectedAt" timestamp (3),
	"disconnectedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WhatsAppPhoneNumber" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"businessAccountId" uuid NOT NULL,
	"phoneNumberId" text NOT NULL,
	"displayPhoneNumber" text NOT NULL,
	"verifiedName" text,
	"qualityRating" text,
	"messagingLimit" text,
	"isDefault" boolean DEFAULT false NOT NULL,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"registrationStatus" text DEFAULT 'CONNECTED' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WhatsAppTemplate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"businessAccountId" uuid NOT NULL,
	"metaTemplateId" text,
	"name" text NOT NULL,
	"category" "WhatsAppTemplateCategory" NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requestedCategory" text,
	"approvedCategory" text,
	"status" "WhatsAppTemplateStatus" DEFAULT 'DRAFT' NOT NULL,
	"rejectionReason" text,
	"qualityRating" text,
	"submittedAt" timestamp (3),
	"approvedAt" timestamp (3),
	"lastSyncedAt" timestamp (3),
	"createdBy" uuid,
	"updatedBy" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WhatsAppContact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"phoneNumber" text NOT NULL,
	"waId" text,
	"displayName" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WhatsAppContactConsent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"contactId" uuid NOT NULL,
	"purpose" "WhatsAppConsentPurpose" NOT NULL,
	"status" "WhatsAppConsentStatus" DEFAULT 'OPTED_IN' NOT NULL,
	"consentSource" text DEFAULT 'DIRECT' NOT NULL,
	"policyVersion" text DEFAULT 'v1.0',
	"consentedAt" timestamp (3) DEFAULT now() NOT NULL,
	"revokedAt" timestamp (3),
	"evidenceReference" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WhatsAppConversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"phoneNumberId" text NOT NULL,
	"contactId" uuid NOT NULL,
	"assignedStaffId" uuid,
	"status" "WhatsAppConversationStatus" DEFAULT 'OPEN' NOT NULL,
	"lastInboundMessageAt" timestamp (3),
	"customerServiceWindowExpiresAt" timestamp (3),
	"lastMessageAt" timestamp (3),
	"unreadCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WhatsAppMessage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"phoneNumberId" text NOT NULL,
	"contactId" uuid NOT NULL,
	"conversationId" uuid,
	"direction" "WhatsAppMessageDirection" NOT NULL,
	"messageType" "WhatsAppMessageType" NOT NULL,
	"templateId" uuid,
	"providerMessageId" text,
	"idempotencyKey" text,
	"body" text,
	"payload" jsonb,
	"providerStatus" text,
	"internalStatus" "WhatsAppMessageInternalStatus" DEFAULT 'QUEUED' NOT NULL,
	"errorCode" text,
	"errorMessage" text,
	"scheduledAt" timestamp (3),
	"acceptedAt" timestamp (3),
	"sentAt" timestamp (3),
	"deliveredAt" timestamp (3),
	"readAt" timestamp (3),
	"failedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WhatsAppMessageAttachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"messageId" uuid NOT NULL,
	"storageKey" text NOT NULL,
	"providerMediaId" text,
	"mimeType" text NOT NULL,
	"filename" text NOT NULL,
	"sizeBytes" bigint,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WhatsAppScheduledMessage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"messageId" uuid NOT NULL,
	"scheduledAt" timestamp (3) NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"status" "WhatsAppScheduledMessageStatus" DEFAULT 'SCHEDULED' NOT NULL,
	"queueJobId" text,
	"cancelledAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WhatsAppCampaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"name" text NOT NULL,
	"templateId" uuid NOT NULL,
	"phoneNumberId" text NOT NULL,
	"status" "WhatsAppCampaignStatus" DEFAULT 'DRAFT' NOT NULL,
	"scheduledAt" timestamp (3),
	"totalRecipients" integer DEFAULT 0 NOT NULL,
	"acceptedCount" integer DEFAULT 0 NOT NULL,
	"deliveredCount" integer DEFAULT 0 NOT NULL,
	"readCount" integer DEFAULT 0 NOT NULL,
	"failedCount" integer DEFAULT 0 NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WhatsAppCampaignRecipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"campaignId" uuid NOT NULL,
	"contactId" uuid NOT NULL,
	"messageId" uuid,
	"status" "WhatsAppCampaignRecipientStatus" DEFAULT 'PENDING' NOT NULL,
	"errorCode" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WhatsAppUsageRecord" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"wabaId" text NOT NULL,
	"phoneNumberId" text NOT NULL,
	"recipientCountry" text DEFAULT 'IN' NOT NULL,
	"templateCategory" text NOT NULL,
	"providerMessageId" text,
	"deliveryStatus" text DEFAULT 'QUEUED' NOT NULL,
	"messageTimestamp" timestamp (3) DEFAULT now() NOT NULL,
	"pricingRateCardVersion" text DEFAULT '2025-07' NOT NULL,
	"estimatedCost" numeric(10, 4) DEFAULT '0.0000' NOT NULL,
	"actualCost" numeric(10, 4),
	"currency" text DEFAULT 'INR' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PlatformWhatsAppAccountRegistry" ADD CONSTRAINT "PlatformWhatsAppAccountRegistry_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppBusinessAccount" ADD CONSTRAINT "WhatsAppBusinessAccount_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppBusinessAccount" ADD CONSTRAINT "WhatsAppBusinessAccount_connectedBy_User_id_fk" FOREIGN KEY ("connectedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppPhoneNumber" ADD CONSTRAINT "WhatsAppPhoneNumber_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppPhoneNumber" ADD CONSTRAINT "WhatsAppPhoneNumber_businessAccountId_WhatsAppBusinessAccount_id_fk" FOREIGN KEY ("businessAccountId") REFERENCES "public"."WhatsAppBusinessAccount"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_businessAccountId_WhatsAppBusinessAccount_id_fk" FOREIGN KEY ("businessAccountId") REFERENCES "public"."WhatsAppBusinessAccount"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_updatedBy_User_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppContact" ADD CONSTRAINT "WhatsAppContact_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppContactConsent" ADD CONSTRAINT "WhatsAppContactConsent_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppContactConsent" ADD CONSTRAINT "WhatsAppContactConsent_contactId_WhatsAppContact_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."WhatsAppContact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_contactId_WhatsAppContact_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."WhatsAppContact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_assignedStaffId_User_id_fk" FOREIGN KEY ("assignedStaffId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_contactId_WhatsAppContact_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."WhatsAppContact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_WhatsAppConversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."WhatsAppConversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_templateId_WhatsAppTemplate_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."WhatsAppTemplate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppMessageAttachment" ADD CONSTRAINT "WhatsAppMessageAttachment_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppMessageAttachment" ADD CONSTRAINT "WhatsAppMessageAttachment_messageId_WhatsAppMessage_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."WhatsAppMessage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppScheduledMessage" ADD CONSTRAINT "WhatsAppScheduledMessage_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppScheduledMessage" ADD CONSTRAINT "WhatsAppScheduledMessage_messageId_WhatsAppMessage_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."WhatsAppMessage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppCampaign" ADD CONSTRAINT "WhatsAppCampaign_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppCampaign" ADD CONSTRAINT "WhatsAppCampaign_templateId_WhatsAppTemplate_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."WhatsAppTemplate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppCampaign" ADD CONSTRAINT "WhatsAppCampaign_createdBy_User_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppCampaignRecipient" ADD CONSTRAINT "WhatsAppCampaignRecipient_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppCampaignRecipient" ADD CONSTRAINT "WhatsAppCampaignRecipient_campaignId_WhatsAppCampaign_id_fk" FOREIGN KEY ("campaignId") REFERENCES "public"."WhatsAppCampaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppCampaignRecipient" ADD CONSTRAINT "WhatsAppCampaignRecipient_contactId_WhatsAppContact_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."WhatsAppContact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppCampaignRecipient" ADD CONSTRAINT "WhatsAppCampaignRecipient_messageId_WhatsAppMessage_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."WhatsAppMessage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhatsAppUsageRecord" ADD CONSTRAINT "WhatsAppUsageRecord_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "WhatsAppOtp_phone_purpose_created_idx" ON "WhatsAppOtpChallenge" USING btree ("phoneNumber","purpose","createdAt");--> statement-breakpoint
CREATE INDEX "WhatsAppOtp_expiresAt_idx" ON "WhatsAppOtpChallenge" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformWhatsApp_phoneNumberId_idx" ON "PlatformWhatsAppAccountRegistry" USING btree ("phoneNumberId");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformWhatsApp_tenant_waba_phone_idx" ON "PlatformWhatsAppAccountRegistry" USING btree ("tenantId","wabaId","phoneNumberId");--> statement-breakpoint
CREATE INDEX "PlatformWhatsApp_tenantId_idx" ON "PlatformWhatsAppAccountRegistry" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "PlatformWhatsApp_wabaId_idx" ON "PlatformWhatsAppAccountRegistry" USING btree ("wabaId");--> statement-breakpoint
CREATE UNIQUE INDEX "WhatsAppBusinessAccount_tenant_waba_idx" ON "WhatsAppBusinessAccount" USING btree ("tenantId","wabaId");--> statement-breakpoint
CREATE INDEX "WhatsAppBusinessAccount_tenantId_idx" ON "WhatsAppBusinessAccount" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "WhatsAppBusinessAccount_wabaId_idx" ON "WhatsAppBusinessAccount" USING btree ("wabaId");--> statement-breakpoint
CREATE UNIQUE INDEX "WhatsAppPhoneNumber_tenant_phoneId_idx" ON "WhatsAppPhoneNumber" USING btree ("tenantId","phoneNumberId");--> statement-breakpoint
CREATE INDEX "WhatsAppPhoneNumber_tenantId_idx" ON "WhatsAppPhoneNumber" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "WhatsAppPhoneNumber_businessAccountId_idx" ON "WhatsAppPhoneNumber" USING btree ("businessAccountId");--> statement-breakpoint
CREATE INDEX "WhatsAppPhoneNumber_phoneNumberId_idx" ON "WhatsAppPhoneNumber" USING btree ("phoneNumberId");--> statement-breakpoint
CREATE UNIQUE INDEX "WhatsAppTemplate_tenant_waba_name_lang_idx" ON "WhatsAppTemplate" USING btree ("tenantId","businessAccountId","name","language");--> statement-breakpoint
CREATE INDEX "WhatsAppTemplate_tenantId_idx" ON "WhatsAppTemplate" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "WhatsAppTemplate_businessAccountId_idx" ON "WhatsAppTemplate" USING btree ("businessAccountId");--> statement-breakpoint
CREATE INDEX "WhatsAppTemplate_status_idx" ON "WhatsAppTemplate" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "WhatsAppTemplate_metaTemplateId_idx" ON "WhatsAppTemplate" USING btree ("metaTemplateId");--> statement-breakpoint
CREATE UNIQUE INDEX "WhatsAppContact_tenant_phone_idx" ON "WhatsAppContact" USING btree ("tenantId","phoneNumber");--> statement-breakpoint
CREATE INDEX "WhatsAppContact_tenantId_idx" ON "WhatsAppContact" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "WhatsAppContact_waId_idx" ON "WhatsAppContact" USING btree ("waId");--> statement-breakpoint
CREATE UNIQUE INDEX "WhatsAppContactConsent_contact_purpose_idx" ON "WhatsAppContactConsent" USING btree ("tenantId","contactId","purpose");--> statement-breakpoint
CREATE INDEX "WhatsAppContactConsent_tenantId_idx" ON "WhatsAppContactConsent" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "WhatsAppContactConsent_contactId_idx" ON "WhatsAppContactConsent" USING btree ("contactId");--> statement-breakpoint
CREATE UNIQUE INDEX "WhatsAppConversation_tenant_phone_contact_idx" ON "WhatsAppConversation" USING btree ("tenantId","phoneNumberId","contactId");--> statement-breakpoint
CREATE INDEX "WhatsAppConversation_tenantId_idx" ON "WhatsAppConversation" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "WhatsAppConversation_contactId_idx" ON "WhatsAppConversation" USING btree ("contactId");--> statement-breakpoint
CREATE INDEX "WhatsAppConversation_status_idx" ON "WhatsAppConversation" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "WhatsAppConversation_lastMessageAt_idx" ON "WhatsAppConversation" USING btree ("tenantId","lastMessageAt");--> statement-breakpoint
CREATE UNIQUE INDEX "WhatsAppMessage_tenant_idempotency_idx" ON "WhatsAppMessage" USING btree ("tenantId","idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "WhatsAppMessage_providerMessageId_idx" ON "WhatsAppMessage" USING btree ("providerMessageId");--> statement-breakpoint
CREATE INDEX "WhatsAppMessage_tenantId_createdAt_idx" ON "WhatsAppMessage" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE INDEX "WhatsAppMessage_tenant_contact_created_idx" ON "WhatsAppMessage" USING btree ("tenantId","contactId","createdAt");--> statement-breakpoint
CREATE INDEX "WhatsAppMessage_tenant_conversation_created_idx" ON "WhatsAppMessage" USING btree ("tenantId","conversationId","createdAt");--> statement-breakpoint
CREATE INDEX "WhatsAppMessage_tenant_status_created_idx" ON "WhatsAppMessage" USING btree ("tenantId","internalStatus","createdAt");--> statement-breakpoint
CREATE INDEX "WhatsAppAttachment_messageId_idx" ON "WhatsAppMessageAttachment" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "WhatsAppAttachment_tenantId_idx" ON "WhatsAppMessageAttachment" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "WhatsAppAttachment_providerMediaId_idx" ON "WhatsAppMessageAttachment" USING btree ("providerMediaId");--> statement-breakpoint
CREATE INDEX "WhatsAppScheduled_tenant_status_sched_idx" ON "WhatsAppScheduledMessage" USING btree ("tenantId","status","scheduledAt");--> statement-breakpoint
CREATE INDEX "WhatsAppScheduled_messageId_idx" ON "WhatsAppScheduledMessage" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "WhatsAppCampaign_tenant_status_created_idx" ON "WhatsAppCampaign" USING btree ("tenantId","status","createdAt");--> statement-breakpoint
CREATE INDEX "WhatsAppCampaign_tenantId_idx" ON "WhatsAppCampaign" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "WhatsAppCampaignRecipient_campaign_status_idx" ON "WhatsAppCampaignRecipient" USING btree ("campaignId","status");--> statement-breakpoint
CREATE INDEX "WhatsAppCampaignRecipient_tenantId_idx" ON "WhatsAppCampaignRecipient" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "WhatsAppCampaignRecipient_contactId_idx" ON "WhatsAppCampaignRecipient" USING btree ("contactId");--> statement-breakpoint
CREATE INDEX "WhatsAppUsage_tenant_timestamp_idx" ON "WhatsAppUsageRecord" USING btree ("tenantId","messageTimestamp");--> statement-breakpoint
CREATE INDEX "WhatsAppUsage_providerMessageId_idx" ON "WhatsAppUsageRecord" USING btree ("providerMessageId");--> statement-breakpoint
CREATE INDEX "WhatsAppUsage_tenant_category_idx" ON "WhatsAppUsageRecord" USING btree ("tenantId","templateCategory");