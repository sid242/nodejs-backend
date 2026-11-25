CREATE TABLE "ChatMessageAttachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"channelId" uuid NOT NULL,
	"messageId" uuid NOT NULL,
	"storageKey" varchar(1024) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mimeType" varchar(150) NOT NULL,
	"sizeBytes" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ChatMessageAttachment_size_ck" CHECK ("ChatMessageAttachment"."sizeBytes" > 0),
	CONSTRAINT "ChatMessageAttachment_position_ck" CHECK ("ChatMessageAttachment"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ChatMessageMention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"channelId" uuid NOT NULL,
	"messageId" uuid NOT NULL,
	"mentionedUserId" uuid NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PlatformChatMessageAttachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channelId" uuid NOT NULL,
	"messageId" uuid NOT NULL,
	"storageKey" varchar(1024) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mimeType" varchar(150) NOT NULL,
	"sizeBytes" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "PlatformChatMessageAttachment_storageKey_unique" UNIQUE("storageKey"),
	CONSTRAINT "PlatformChatMessageAttachment_size_ck" CHECK ("PlatformChatMessageAttachment"."sizeBytes" > 0),
	CONSTRAINT "PlatformChatMessageAttachment_position_ck" CHECK ("PlatformChatMessageAttachment"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "PlatformChatMessageMention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channelId" uuid NOT NULL,
	"messageId" uuid NOT NULL,
	"mentionedStaffId" uuid NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ChatChannelMember" DROP CONSTRAINT "ChatChannelMember_channelId_ChatChannel_id_fk";
--> statement-breakpoint
ALTER TABLE "ChatMessageReaction" DROP CONSTRAINT "ChatMessageReaction_tenantId_Tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "ChatMessageReaction" DROP CONSTRAINT "ChatMessageReaction_channelId_ChatChannel_id_fk";
--> statement-breakpoint
ALTER TABLE "ChatMessageReaction" DROP CONSTRAINT "ChatMessageReaction_messageId_ChatMessage_id_fk";
--> statement-breakpoint
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_tenantId_Tenant_id_fk";
--> statement-breakpoint
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_channelId_ChatChannel_id_fk";
--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" DROP CONSTRAINT "PlatformChatChannelMember_channelId_PlatformChatChannel_id_fk";
--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" DROP CONSTRAINT "PlatformChatChannelMember_staffId_PlatformStaff_id_fk";
--> statement-breakpoint
ALTER TABLE "PlatformChatChannel" DROP CONSTRAINT "PlatformChatChannel_createdByStaffId_PlatformStaff_id_fk";
--> statement-breakpoint
ALTER TABLE "PlatformChatMessageReaction" DROP CONSTRAINT "PlatformChatMessageReaction_channelId_PlatformChatChannel_id_fk";
--> statement-breakpoint
ALTER TABLE "PlatformChatMessageReaction" DROP CONSTRAINT "PlatformChatMessageReaction_messageId_PlatformChatMessage_id_fk";
--> statement-breakpoint
ALTER TABLE "PlatformChatMessageReaction" DROP CONSTRAINT "PlatformChatMessageReaction_staffId_PlatformStaff_id_fk";
--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" DROP CONSTRAINT "PlatformChatMessage_channelId_PlatformChatChannel_id_fk";
--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" DROP CONSTRAINT "PlatformChatMessage_senderId_PlatformStaff_id_fk";
--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" DROP CONSTRAINT "PlatformChatMessage_pinnedByStaffId_PlatformStaff_id_fk";
--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" DROP CONSTRAINT "PlatformChatMessage_deletedByStaffId_PlatformStaff_id_fk";
--> statement-breakpoint
DROP INDEX "ChatChannelMember_channelId_userId_key";--> statement-breakpoint
DROP INDEX "ChatChannelMember_tenantId_userId_idx";--> statement-breakpoint
DROP INDEX "ChatChannel_tenantId_directKey_key";--> statement-breakpoint
DROP INDEX "ChatChannel_tenantId_slug_key";--> statement-breakpoint
DROP INDEX "ChatChannel_tenantId_archived_lastMsg_idx";--> statement-breakpoint
DROP INDEX "ChatMessageReaction_messageId_userId_emoji_key";--> statement-breakpoint
DROP INDEX "ChatMessageReaction_channelId_messageId_idx";--> statement-breakpoint
DROP INDEX "ChatMessage_channelId_createdAt_idx";--> statement-breakpoint
DROP INDEX "ChatMessage_tenantId_channelId_deleted_idx";--> statement-breakpoint
DROP INDEX "ChatMessage_parentMessageId_idx";--> statement-breakpoint
DROP INDEX "PlatformChatChannelMember_channelId_staffId_key";--> statement-breakpoint
DROP INDEX "PlatformChatChannelMember_staffId_pinned_idx";--> statement-breakpoint
DROP INDEX "PlatformChatChannel_directKey_key";--> statement-breakpoint
DROP INDEX "PlatformChatChannel_slug_key";--> statement-breakpoint
DROP INDEX "PlatformChatChannel_archived_lastMsg_idx";--> statement-breakpoint
DROP INDEX "PlatformChatMessageReaction_msg_staff_emoji_key";--> statement-breakpoint
DROP INDEX "PlatformChatMessageReaction_channelId_messageId_idx";--> statement-breakpoint
DROP INDEX "PlatformChatMessage_channelId_createdAt_idx";--> statement-breakpoint
DROP INDEX "PlatformChatMessage_parentMessageId_idx";--> statement-breakpoint
ALTER TABLE "ChatChannelMember" ALTER COLUMN "lastReadAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatChannelMember" ALTER COLUMN "joinedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatChannelMember" ALTER COLUMN "joinedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ChatChannelMember" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatChannelMember" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ChatChannel" ALTER COLUMN "archivedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatChannel" ALTER COLUMN "lastMessageAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatChannel" ALTER COLUMN "createdAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatChannel" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ChatChannel" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatChannel" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ChatMessageReaction" ALTER COLUMN "createdAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatMessageReaction" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ChatMessage" ALTER COLUMN "body" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "ChatMessage" ALTER COLUMN "pinnedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatMessage" ALTER COLUMN "editedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatMessage" ALTER COLUMN "deletedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatMessage" ALTER COLUMN "createdAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatMessage" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ChatMessage" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ChatMessage" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" ALTER COLUMN "lastReadAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" ALTER COLUMN "joinedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" ALTER COLUMN "joinedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "PlatformChatChannel" ALTER COLUMN "archivedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatChannel" ALTER COLUMN "lastMessageAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatChannel" ALTER COLUMN "createdAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatChannel" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "PlatformChatChannel" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatChannel" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "PlatformChatMessageReaction" ALTER COLUMN "createdAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatMessageReaction" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ALTER COLUMN "body" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ALTER COLUMN "pinnedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ALTER COLUMN "editedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ALTER COLUMN "deletedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ALTER COLUMN "createdAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ALTER COLUMN "createdAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ChatChannelMember" ADD COLUMN "leftAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" ADD COLUMN "leftAt" timestamp (3) with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "ChatChannelMember_tenant_channel_user_uq" ON "ChatChannelMember" USING btree ("tenantId","channelId","userId");--> statement-breakpoint
CREATE INDEX "ChatChannelMember_tenant_user_pinned_idx" ON "ChatChannelMember" USING btree ("tenantId","userId","isPinned");--> statement-breakpoint
CREATE INDEX "ChatChannelMember_channel_unread_idx" ON "ChatChannelMember" USING btree ("tenantId","channelId","unreadCount");--> statement-breakpoint
CREATE UNIQUE INDEX "ChatChannel_tenant_id_id_uq" ON "ChatChannel" USING btree ("tenantId","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ChatChannel_tenant_direct_key_uq" ON "ChatChannel" USING btree ("tenantId","directKey") WHERE "ChatChannel"."directKey" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ChatChannel_tenant_slug_uq" ON "ChatChannel" USING btree ("tenantId","slug") WHERE "ChatChannel"."slug" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ChatChannel_tenant_archived_last_message_idx" ON "ChatChannel" USING btree ("tenantId","isArchived","lastMessageAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ChatMessageReaction_message_user_emoji_uq" ON "ChatMessageReaction" USING btree ("tenantId","messageId","userId","emoji");--> statement-breakpoint
CREATE INDEX "ChatMessageReaction_channel_message_idx" ON "ChatMessageReaction" USING btree ("tenantId","channelId","messageId");--> statement-breakpoint
CREATE UNIQUE INDEX "ChatMessage_tenant_channel_id_uq" ON "ChatMessage" USING btree ("tenantId","channelId","id");--> statement-breakpoint
CREATE INDEX "ChatMessage_tenant_channel_timeline_idx" ON "ChatMessage" USING btree ("tenantId","channelId","createdAt","id");--> statement-breakpoint
CREATE INDEX "ChatMessage_tenant_channel_parent_idx" ON "ChatMessage" USING btree ("tenantId","channelId","parentMessageId");--> statement-breakpoint
CREATE INDEX "ChatMessage_live_timeline_idx" ON "ChatMessage" USING btree ("tenantId","channelId","createdAt","id") WHERE "ChatMessage"."deletedAt" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformChatChannelMember_channel_staff_uq" ON "PlatformChatChannelMember" USING btree ("channelId","staffId");--> statement-breakpoint
CREATE INDEX "PlatformChatChannelMember_staff_pinned_idx" ON "PlatformChatChannelMember" USING btree ("staffId","isPinned");--> statement-breakpoint
CREATE INDEX "PlatformChatChannelMember_channel_unread_idx" ON "PlatformChatChannelMember" USING btree ("channelId","unreadCount");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformChatChannel_direct_key_uq" ON "PlatformChatChannel" USING btree ("directKey") WHERE "PlatformChatChannel"."directKey" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformChatChannel_slug_uq" ON "PlatformChatChannel" USING btree ("slug") WHERE "PlatformChatChannel"."slug" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "PlatformChatChannel_active_last_message_idx" ON "PlatformChatChannel" USING btree ("isArchived","lastMessageAt");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformChatMessageReaction_message_staff_emoji_uq" ON "PlatformChatMessageReaction" USING btree ("messageId","staffId","emoji");--> statement-breakpoint
CREATE INDEX "PlatformChatMessageReaction_channel_message_idx" ON "PlatformChatMessageReaction" USING btree ("channelId","messageId");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformChatMessage_channel_id_uq" ON "PlatformChatMessage" USING btree ("channelId","id");--> statement-breakpoint
CREATE INDEX "PlatformChatMessage_channel_timeline_idx" ON "PlatformChatMessage" USING btree ("channelId","createdAt","id");--> statement-breakpoint
CREATE INDEX "PlatformChatMessage_channel_parent_idx" ON "PlatformChatMessage" USING btree ("channelId","parentMessageId");--> statement-breakpoint
CREATE INDEX "PlatformChatMessage_live_timeline_idx" ON "PlatformChatMessage" USING btree ("channelId","createdAt","id") WHERE "PlatformChatMessage"."deletedAt" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ChatMessageAttachment_tenant_storage_uq" ON "ChatMessageAttachment" USING btree ("tenantId","storageKey");--> statement-breakpoint
CREATE INDEX "ChatMessageAttachment_message_position_idx" ON "ChatMessageAttachment" USING btree ("tenantId","messageId","position");--> statement-breakpoint
CREATE UNIQUE INDEX "ChatMessageMention_message_user_uq" ON "ChatMessageMention" USING btree ("tenantId","messageId","mentionedUserId");--> statement-breakpoint
CREATE INDEX "ChatMessageMention_user_created_idx" ON "ChatMessageMention" USING btree ("tenantId","mentionedUserId","createdAt");--> statement-breakpoint
CREATE INDEX "PlatformChatMessageAttachment_message_position_idx" ON "PlatformChatMessageAttachment" USING btree ("messageId","position");--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformChatMessageMention_message_staff_uq" ON "PlatformChatMessageMention" USING btree ("messageId","mentionedStaffId");--> statement-breakpoint
CREATE INDEX "PlatformChatMessageMention_staff_created_idx" ON "PlatformChatMessageMention" USING btree ("mentionedStaffId","createdAt");--> statement-breakpoint
ALTER TABLE "ChatMessageAttachment" ADD CONSTRAINT "ChatMessageAttachment_message_scope_fk" FOREIGN KEY ("tenantId","channelId","messageId") REFERENCES "public"."ChatMessage"("tenantId","channelId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessageMention" ADD CONSTRAINT "ChatMessageMention_message_scope_fk" FOREIGN KEY ("tenantId","channelId","messageId") REFERENCES "public"."ChatMessage"("tenantId","channelId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessageMention" ADD CONSTRAINT "ChatMessageMention_target_membership_fk" FOREIGN KEY ("tenantId","channelId","mentionedUserId") REFERENCES "public"."ChatChannelMember"("tenantId","channelId","userId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessageAttachment" ADD CONSTRAINT "PlatformChatMessageAttachment_message_scope_fk" FOREIGN KEY ("channelId","messageId") REFERENCES "public"."PlatformChatMessage"("channelId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessageMention" ADD CONSTRAINT "PlatformChatMessageMention_message_scope_fk" FOREIGN KEY ("channelId","messageId") REFERENCES "public"."PlatformChatMessage"("channelId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessageMention" ADD CONSTRAINT "PlatformChatMessageMention_target_membership_fk" FOREIGN KEY ("channelId","mentionedStaffId") REFERENCES "public"."PlatformChatChannelMember"("channelId","staffId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatChannelMember" ADD CONSTRAINT "ChatChannelMember_tenant_channel_fk" FOREIGN KEY ("tenantId","channelId") REFERENCES "public"."ChatChannel"("tenantId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessageReaction" ADD CONSTRAINT "ChatMessageReaction_message_scope_fk" FOREIGN KEY ("tenantId","channelId","messageId") REFERENCES "public"."ChatMessage"("tenantId","channelId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessageReaction" ADD CONSTRAINT "ChatMessageReaction_actor_membership_fk" FOREIGN KEY ("tenantId","channelId","userId") REFERENCES "public"."ChatChannelMember"("tenantId","channelId","userId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_tenant_channel_fk" FOREIGN KEY ("tenantId","channelId") REFERENCES "public"."ChatChannel"("tenantId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sender_membership_fk" FOREIGN KEY ("tenantId","channelId","senderId") REFERENCES "public"."ChatChannelMember"("tenantId","channelId","userId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_pinner_membership_fk" FOREIGN KEY ("tenantId","channelId","pinnedByUserId") REFERENCES "public"."ChatChannelMember"("tenantId","channelId","userId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_deleter_membership_fk" FOREIGN KEY ("tenantId","channelId","deletedByUserId") REFERENCES "public"."ChatChannelMember"("tenantId","channelId","userId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_parent_same_channel_fk" FOREIGN KEY ("tenantId","channelId","parentMessageId") REFERENCES "public"."ChatMessage"("tenantId","channelId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" ADD CONSTRAINT "PlatformChatChannelMember_channel_fk" FOREIGN KEY ("channelId") REFERENCES "public"."PlatformChatChannel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" ADD CONSTRAINT "PlatformChatChannelMember_staffId_PlatformStaff_id_fk" FOREIGN KEY ("staffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatChannel" ADD CONSTRAINT "PlatformChatChannel_createdByStaffId_PlatformStaff_id_fk" FOREIGN KEY ("createdByStaffId") REFERENCES "public"."PlatformStaff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessageReaction" ADD CONSTRAINT "PlatformChatMessageReaction_message_scope_fk" FOREIGN KEY ("channelId","messageId") REFERENCES "public"."PlatformChatMessage"("channelId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessageReaction" ADD CONSTRAINT "PlatformChatMessageReaction_actor_membership_fk" FOREIGN KEY ("channelId","staffId") REFERENCES "public"."PlatformChatChannelMember"("channelId","staffId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ADD CONSTRAINT "PlatformChatMessage_channel_fk" FOREIGN KEY ("channelId") REFERENCES "public"."PlatformChatChannel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ADD CONSTRAINT "PlatformChatMessage_sender_membership_fk" FOREIGN KEY ("channelId","senderId") REFERENCES "public"."PlatformChatChannelMember"("channelId","staffId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ADD CONSTRAINT "PlatformChatMessage_pinner_membership_fk" FOREIGN KEY ("channelId","pinnedByStaffId") REFERENCES "public"."PlatformChatChannelMember"("channelId","staffId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ADD CONSTRAINT "PlatformChatMessage_deleter_membership_fk" FOREIGN KEY ("channelId","deletedByStaffId") REFERENCES "public"."PlatformChatChannelMember"("channelId","staffId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ADD CONSTRAINT "PlatformChatMessage_parent_same_channel_fk" FOREIGN KEY ("channelId","parentMessageId") REFERENCES "public"."PlatformChatMessage"("channelId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ChatMessage" DROP COLUMN "mentions";--> statement-breakpoint
ALTER TABLE "ChatMessage" DROP COLUMN "attachments";--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" DROP COLUMN "mentions";--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" DROP COLUMN "attachments";--> statement-breakpoint
ALTER TABLE "ChatChannelMember" ADD CONSTRAINT "ChatChannelMember_unread_ck" CHECK ("ChatChannelMember"."unreadCount" >= 0);--> statement-breakpoint
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_message_count_ck" CHECK ("ChatChannel"."messageCount" >= 0);--> statement-breakpoint
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_direct_key_ck" CHECK (("ChatChannel"."type" = 'DIRECT' AND "ChatChannel"."directKey" IS NOT NULL) OR ("ChatChannel"."type" <> 'DIRECT' AND "ChatChannel"."directKey" IS NULL));--> statement-breakpoint
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_reply_count_ck" CHECK ("ChatMessage"."replyCount" >= 0);--> statement-breakpoint
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_not_self_parent_ck" CHECK ("ChatMessage"."parentMessageId" IS NULL OR "ChatMessage"."parentMessageId" <> "ChatMessage"."id");--> statement-breakpoint
ALTER TABLE "PlatformChatChannelMember" ADD CONSTRAINT "PlatformChatChannelMember_unread_ck" CHECK ("PlatformChatChannelMember"."unreadCount" >= 0);--> statement-breakpoint
ALTER TABLE "PlatformChatChannel" ADD CONSTRAINT "PlatformChatChannel_message_count_ck" CHECK ("PlatformChatChannel"."messageCount" >= 0);--> statement-breakpoint
ALTER TABLE "PlatformChatChannel" ADD CONSTRAINT "PlatformChatChannel_direct_key_ck" CHECK (("PlatformChatChannel"."type" = 'DIRECT' AND "PlatformChatChannel"."directKey" IS NOT NULL) OR ("PlatformChatChannel"."type" <> 'DIRECT' AND "PlatformChatChannel"."directKey" IS NULL));--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ADD CONSTRAINT "PlatformChatMessage_reply_count_ck" CHECK ("PlatformChatMessage"."replyCount" >= 0);--> statement-breakpoint
ALTER TABLE "PlatformChatMessage" ADD CONSTRAINT "PlatformChatMessage_not_self_parent_ck" CHECK ("PlatformChatMessage"."parentMessageId" IS NULL OR "PlatformChatMessage"."parentMessageId" <> "PlatformChatMessage"."id");