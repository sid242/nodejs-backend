import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { chatChannelTypeEnum, chatMessageTypeEnum, chatParticipantRoleEnum } from '../enums';
import { tenants } from '../tenancy/tenants';

const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 3, mode: 'date' });
const createdAt = () => ts('createdAt').notNull().defaultNow();
const updatedAt = () => ts('updatedAt').notNull().defaultNow();

/**
 * Tenant-scoped chat tables (RLS + dedicated DB compatible).
 * ChatChannelMember is the durable per-channel membership ledger; mark departures via
 * `leftAt` instead of hard-deleting so historical message/reaction/mention FKs remain intact.
 */

// scope: tenant
export const chatChannels = pgTable(
  'ChatChannel',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: chatChannelTypeEnum('type').notNull().default('PUBLIC'),
    name: varchar('name', { length: 120 }),
    slug: varchar('slug', { length: 120 }),
    description: text('description'),
    topic: varchar('topic', { length: 255 }),
    directKey: varchar('directKey', { length: 100 }),
    createdByUserId: uuid('createdByUserId').notNull(),
    isArchived: boolean('isArchived').notNull().default(false),
    archivedAt: ts('archivedAt'),
    lastMessageAt: ts('lastMessageAt'),
    lastMessagePreview: varchar('lastMessagePreview', { length: 240 }),
    lastMessageSenderId: uuid('lastMessageSenderId'),
    messageCount: integer('messageCount').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ChatChannel_tenant_id_id_uq').on(t.tenantId, t.id),
    uniqueIndex('ChatChannel_tenant_direct_key_uq')
      .on(t.tenantId, t.directKey)
      .where(sql`${t.directKey} IS NOT NULL`),
    uniqueIndex('ChatChannel_tenant_slug_uq')
      .on(t.tenantId, t.slug)
      .where(sql`${t.slug} IS NOT NULL`),
    index('ChatChannel_tenant_archived_last_message_idx').on(
      t.tenantId,
      t.isArchived,
      t.lastMessageAt,
    ),
    check('ChatChannel_message_count_ck', sql`${t.messageCount} >= 0`),
    check(
      'ChatChannel_direct_key_ck',
      sql`(${t.type} = 'DIRECT' AND ${t.directKey} IS NOT NULL) OR (${t.type} <> 'DIRECT' AND ${t.directKey} IS NULL)`,
    ),
  ],
);

// scope: tenant
export const chatChannelMembers = pgTable(
  'ChatChannelMember',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    channelId: uuid('channelId').notNull(),
    userId: uuid('userId').notNull(),
    role: chatParticipantRoleEnum('role').notNull().default('MEMBER'),
    isMuted: boolean('isMuted').notNull().default(false),
    isPinned: boolean('isPinned').notNull().default(false),
    lastReadAt: ts('lastReadAt'),
    lastReadMessageId: uuid('lastReadMessageId'),
    unreadCount: integer('unreadCount').notNull().default(0),
    joinedAt: ts('joinedAt').notNull().defaultNow(),
    leftAt: ts('leftAt'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ChatChannelMember_tenant_channel_user_uq').on(t.tenantId, t.channelId, t.userId),
    foreignKey({
      name: 'ChatChannelMember_tenant_channel_fk',
      columns: [t.tenantId, t.channelId],
      foreignColumns: [chatChannels.tenantId, chatChannels.id],
    }).onDelete('cascade'),
    index('ChatChannelMember_tenant_user_pinned_idx').on(t.tenantId, t.userId, t.isPinned),
    index('ChatChannelMember_channel_unread_idx').on(t.tenantId, t.channelId, t.unreadCount),
    check('ChatChannelMember_unread_ck', sql`${t.unreadCount} >= 0`),
  ],
);

// scope: tenant
export const chatMessages = pgTable(
  'ChatMessage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId').notNull(),
    channelId: uuid('channelId').notNull(),
    senderId: uuid('senderId').notNull(),
    type: chatMessageTypeEnum('type').notNull().default('TEXT'),
    body: text('body').notNull().default(''),
    parentMessageId: uuid('parentMessageId'),
    replyCount: integer('replyCount').notNull().default(0),
    isPinned: boolean('isPinned').notNull().default(false),
    pinnedByUserId: uuid('pinnedByUserId'),
    pinnedAt: ts('pinnedAt'),
    editedAt: ts('editedAt'),
    deletedAt: ts('deletedAt'),
    deletedByUserId: uuid('deletedByUserId'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ChatMessage_tenant_channel_id_uq').on(t.tenantId, t.channelId, t.id),
    foreignKey({
      name: 'ChatMessage_tenant_channel_fk',
      columns: [t.tenantId, t.channelId],
      foreignColumns: [chatChannels.tenantId, chatChannels.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ChatMessage_sender_membership_fk',
      columns: [t.tenantId, t.channelId, t.senderId],
      foreignColumns: [
        chatChannelMembers.tenantId,
        chatChannelMembers.channelId,
        chatChannelMembers.userId,
      ],
    }).onDelete('no action'),
    foreignKey({
      name: 'ChatMessage_pinner_membership_fk',
      columns: [t.tenantId, t.channelId, t.pinnedByUserId],
      foreignColumns: [
        chatChannelMembers.tenantId,
        chatChannelMembers.channelId,
        chatChannelMembers.userId,
      ],
    }).onDelete('no action'),
    foreignKey({
      name: 'ChatMessage_deleter_membership_fk',
      columns: [t.tenantId, t.channelId, t.deletedByUserId],
      foreignColumns: [
        chatChannelMembers.tenantId,
        chatChannelMembers.channelId,
        chatChannelMembers.userId,
      ],
    }).onDelete('no action'),
    foreignKey({
      name: 'ChatMessage_parent_same_channel_fk',
      columns: [t.tenantId, t.channelId, t.parentMessageId],
      foreignColumns: [t.tenantId, t.channelId, t.id],
    }).onDelete('no action'),
    index('ChatMessage_tenant_channel_timeline_idx').on(t.tenantId, t.channelId, t.createdAt, t.id),
    index('ChatMessage_tenant_channel_parent_idx').on(t.tenantId, t.channelId, t.parentMessageId),
    index('ChatMessage_live_timeline_idx')
      .on(t.tenantId, t.channelId, t.createdAt, t.id)
      .where(sql`${t.deletedAt} IS NULL`),
    check('ChatMessage_reply_count_ck', sql`${t.replyCount} >= 0`),
    check(
      'ChatMessage_not_self_parent_ck',
      sql`${t.parentMessageId} IS NULL OR ${t.parentMessageId} <> ${t.id}`,
    ),
  ],
);

// scope: tenant
export const chatMessageReactions = pgTable(
  'ChatMessageReaction',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId').notNull(),
    channelId: uuid('channelId').notNull(),
    messageId: uuid('messageId').notNull(),
    userId: uuid('userId').notNull(),
    emoji: varchar('emoji', { length: 32 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'ChatMessageReaction_message_scope_fk',
      columns: [t.tenantId, t.channelId, t.messageId],
      foreignColumns: [chatMessages.tenantId, chatMessages.channelId, chatMessages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ChatMessageReaction_actor_membership_fk',
      columns: [t.tenantId, t.channelId, t.userId],
      foreignColumns: [
        chatChannelMembers.tenantId,
        chatChannelMembers.channelId,
        chatChannelMembers.userId,
      ],
    }).onDelete('no action'),
    uniqueIndex('ChatMessageReaction_message_user_emoji_uq').on(
      t.tenantId,
      t.messageId,
      t.userId,
      t.emoji,
    ),
    index('ChatMessageReaction_channel_message_idx').on(t.tenantId, t.channelId, t.messageId),
  ],
);

// scope: tenant
export const chatMessageAttachments = pgTable(
  'ChatMessageAttachment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId').notNull(),
    channelId: uuid('channelId').notNull(),
    messageId: uuid('messageId').notNull(),
    storageKey: varchar('storageKey', { length: 1024 }).notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mimeType', { length: 150 }).notNull(),
    sizeBytes: integer('sizeBytes').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'ChatMessageAttachment_message_scope_fk',
      columns: [t.tenantId, t.channelId, t.messageId],
      foreignColumns: [chatMessages.tenantId, chatMessages.channelId, chatMessages.id],
    }).onDelete('cascade'),
    uniqueIndex('ChatMessageAttachment_tenant_storage_uq').on(t.tenantId, t.storageKey),
    index('ChatMessageAttachment_message_position_idx').on(t.tenantId, t.messageId, t.position),
    check('ChatMessageAttachment_size_ck', sql`${t.sizeBytes} > 0`),
    check('ChatMessageAttachment_position_ck', sql`${t.position} >= 0`),
  ],
);

// scope: tenant
export const chatMessageMentions = pgTable(
  'ChatMessageMention',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId').notNull(),
    channelId: uuid('channelId').notNull(),
    messageId: uuid('messageId').notNull(),
    mentionedUserId: uuid('mentionedUserId').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'ChatMessageMention_message_scope_fk',
      columns: [t.tenantId, t.channelId, t.messageId],
      foreignColumns: [chatMessages.tenantId, chatMessages.channelId, chatMessages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ChatMessageMention_target_membership_fk',
      columns: [t.tenantId, t.channelId, t.mentionedUserId],
      foreignColumns: [
        chatChannelMembers.tenantId,
        chatChannelMembers.channelId,
        chatChannelMembers.userId,
      ],
    }).onDelete('no action'),
    uniqueIndex('ChatMessageMention_message_user_uq').on(
      t.tenantId,
      t.messageId,
      t.mentionedUserId,
    ),
    index('ChatMessageMention_user_created_idx').on(t.tenantId, t.mentionedUserId, t.createdAt),
  ],
);
