CREATE TYPE "public"."ChatChannelType" AS ENUM('DIRECT', 'GROUP', 'PUBLIC', 'PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."ChatMessageType" AS ENUM('TEXT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."ChatParticipantRole" AS ENUM('OWNER', 'ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TABLE "ChatChannelMember" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"channelId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"role" "ChatParticipantRole" DEFAULT 'MEMBER' NOT NULL,
	"isMuted" boolean DEFAULT false NOT NULL,
	"isPinned" boolean DEFAULT false NOT NULL,
	"lastReadAt" timestamp (3),
	"lastReadMessageId" uuid,
	"unreadCount" integer DEFAULT 0 NOT NULL,
	"joinedAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ChatChannel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"type" "ChatChannelType" DEFAULT 'PUBLIC' NOT NULL,
	"name" varchar(120),
	"slug" varchar(120),
	"description" text,
	"topic" varchar(255),
	"directKey" varchar(100),
	"createdByUserId" uuid NOT NULL,
	"isArchived" boolean DEFAULT false NOT NULL,
	"archivedAt" timestamp (3),
	"lastMessageAt" timestamp (3),
	"lastMessagePreview" varchar(240),
	"lastMessageSenderId" uuid,
	"messageCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ChatMessageReaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"channelId" uuid NOT NULL,
	"messageId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"emoji" varchar(32) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ChatMessage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"channelId" uuid NOT NULL,
	"senderId" uuid NOT NULL,
	"type" "ChatMessageType" DEFAULT 'TEXT' NOT NULL,
	"body" text NOT NULL,
	"parentMessageId" uuid,
	"replyCount" integer DEFAULT 0 NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isPinned" boolean DEFAULT false NOT NULL,
	"pinnedByUserId" uuid,
	"pinnedAt" timestamp (3),
	"editedAt" timestamp (3),
	"deletedAt" timestamp (3),
	"deletedByUserId" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PlatformChatChannelMember" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channelId" uuid NOT NULL,
	"staffId" uuid NOT NULL,
	"role" "ChatParticipantRole" DEFAULT 'MEMBER' NOT NULL,
	"isMuted" boolean DEFAULT false NOT NULL,
	"isPinned" boolean DEFAULT false NOT NULL,
	"lastReadAt" timestamp (3),
	"lastReadMessageId" uuid,
	"unreadCount" integer DEFAULT 0 NOT NULL,
	"joinedAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PlatformChatChannel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "ChatChannelType" DEFAULT 'PUBLIC' NOT NULL,
	"name" varchar(120),
	"slug" varchar(120),
	"description" text,
	"topic" varchar(255),
	"directKey" varchar(100),
	"createdByStaffId" uuid NOT NULL,
	"isArchived" boolean DEFAULT false NOT NULL,
	"archivedAt" timestamp (3),
	"lastMessageAt" timestamp (3),
	"lastMessagePreview" varchar(240),
	"lastMessageSenderId" uuid,
	"messageCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PlatformChatMessageReaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channelId" uuid NOT NULL,
	"messageId" uuid NOT NULL,
	"staffId" uuid NOT NULL,
	"emoji" varchar(32) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PlatformChatMessage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channelId" uuid NOT NULL,
	"senderId" uuid NOT NULL,
	"type" "ChatMessageType" DEFAULT 'TEXT' NOT NULL,
	"body" text NOT NULL,
	"parentMessageId" uuid,
	"replyCount" integer DEFAULT 0 NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isPinned" boolean DEFAULT false NOT NULL,
	"pinnedByStaffId" uuid,
	"pinnedAt" timestamp (3),
	"editedAt" timestamp (3),
	"deletedAt" timestamp (3),
	"deletedByStaffId" uuid,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ChatChannelMember" ADD CONSTRAINT "ChatChannelMember_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatChannelMember" ADD CONSTRAINT "ChatChannelMember_channelId_ChatChannel_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."ChatChannel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessageReaction" ADD CONSTRAINT "ChatMessageReaction_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessageReaction" ADD CONSTRAINT "ChatMessageReaction_channelId_ChatChannel_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."ChatChannel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessageReaction" ADD CONSTRAINT "ChatMessageReaction_messageId_ChatMessage_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."ChatMessage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_channelId_ChatChannel_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."ChatChannel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" ADD CONSTRAINT "PlatformChatChannelMember_channelId_PlatformChatChannel_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."PlatformChatChannel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" ADD CONSTRAINT "PlatformChatChannelMember_staffId_PlatformStaff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatChannel" ADD CONSTRAINT "PlatformChatChannel_createdByStaffId_PlatformStaff_id_fk" FOREIGN KEY ("createdByStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessageReaction" ADD CONSTRAINT "PlatformChatMessageReaction_channelId_PlatformChatChannel_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."PlatformChatChannel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessageReaction" ADD CONSTRAINT "PlatformChatMessageReaction_messageId_PlatformChatMessage_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."PlatformChatMessage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessageReaction" ADD CONSTRAINT "PlatformChatMessageReaction_staffId_PlatformStaff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ADD CONSTRAINT "PlatformChatMessage_channelId_PlatformChatChannel_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."PlatformChatChannel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ADD CONSTRAINT "PlatformChatMessage_senderId_PlatformStaff_id_fk" FOREIGN KEY ("senderId") REFERENCES "public"."PlatformStaff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ADD CONSTRAINT "PlatformChatMessage_pinnedByStaffId_PlatformStaff_id_fk" FOREIGN KEY ("pinnedByStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ADD CONSTRAINT "PlatformChatMessage_deletedByStaffId_PlatformStaff_id_fk" FOREIGN KEY ("deletedByStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ChatChannelMember_channelId_userId_key" ON "ChatChannelMember" USING btree ("channelId","userId");--> statement-breakpoint
CREATE INDEX "ChatChannelMember_tenantId_userId_idx" ON "ChatChannelMember" USING btree ("tenantId","userId","isPinned");--> statement-breakpoint
CREATE UNIQUE INDEX "ChatChannel_tenantId_directKey_key" ON "ChatChannel" USING btree ("tenantId","directKey");--> statement-breakpoint
CREATE UNIQUE INDEX "ChatChannel_tenantId_slug_key" ON "ChatChannel" USING btree ("tenantId","slug");--> statement-breakpoint
CREATE INDEX "ChatChannel_tenantId_archived_lastMsg_idx" ON "ChatChannel" USING btree ("tenantId","isArchived","lastMessageAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ChatMessageReaction_messageId_userId_emoji_key" ON "ChatMessageReaction" USING btree ("messageId","userId","emoji");--> statement-breakpoint
CREATE INDEX "ChatMessageReaction_channelId_messageId_idx" ON "ChatMessageReaction" USING btree ("channelId","messageId");--> statement-breakpoint
CREATE INDEX "ChatMessage_channelId_createdAt_idx" ON "ChatMessage" USING btree ("channelId","createdAt","id");--> statement-breakpoint
CREATE INDEX "ChatMessage_tenantId_channelId_deleted_idx" ON "ChatMessage" USING btree ("tenantId","channelId","deletedAt");--> statement-breakpoint
CREATE INDEX "ChatMessage_parentMessageId_idx" ON "ChatMessage" USING btree ("parentMessageId");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformChatChannelMember_channelId_staffId_key" ON "PlatformChatChannelMember" USING btree ("channelId","staffId");--> statement-breakpoint
CREATE INDEX "PlatformChatChannelMember_staffId_pinned_idx" ON "PlatformChatChannelMember" USING btree ("staffId","isPinned");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformChatChannel_directKey_key" ON "PlatformChatChannel" USING btree ("directKey");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformChatChannel_slug_key" ON "PlatformChatChannel" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "PlatformChatChannel_archived_lastMsg_idx" ON "PlatformChatChannel" USING btree ("isArchived","lastMessageAt");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformChatMessageReaction_msg_staff_emoji_key" ON "PlatformChatMessageReaction" USING btree ("messageId","staffId","emoji");--> statement-breakpoint
CREATE INDEX "PlatformChatMessageReaction_channelId_messageId_idx" ON "PlatformChatMessageReaction" USING btree ("channelId","messageId");--> statement-breakpoint
CREATE INDEX "PlatformChatMessage_channelId_createdAt_idx" ON "PlatformChatMessage" USING btree ("channelId","createdAt","id");--> statement-breakpoint
CREATE INDEX "PlatformChatMessage_parentMessageId_idx" ON "PlatformChatMessage" USING btree ("parentMessageId");