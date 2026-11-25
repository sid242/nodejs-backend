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
import { platformStaff } from '../platform/platform-staff';

const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 3, mode: 'date' });
const createdAt = () => ts('createdAt').notNull().defaultNow();
const updatedAt = () => ts('updatedAt').notNull().defaultNow();

/** Internal platform chat is isolated in the primary database and uses platformStaff IDs. */

// scope: primary
export const platformChatChannels = pgTable(
  'PlatformChatChannel',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: chatChannelTypeEnum('type').notNull().default('PUBLIC'),
    name: varchar('name', { length: 120 }),
    slug: varchar('slug', { length: 120 }),
    description: text('description'),
    topic: varchar('topic', { length: 255 }),
    directKey: varchar('directKey', { length: 100 }),
    createdByStaffId: uuid('createdByStaffId')
      .notNull()
      .references(() => platformStaff.id, { onDelete: 'restrict' }),
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
    uniqueIndex('PlatformChatChannel_direct_key_uq')
      .on(t.directKey)
      .where(sql`${t.directKey} IS NOT NULL`),
    uniqueIndex('PlatformChatChannel_slug_uq')
      .on(t.slug)
      .where(sql`${t.slug} IS NOT NULL`),
    index('PlatformChatChannel_active_last_message_idx').on(t.isArchived, t.lastMessageAt),
    check('PlatformChatChannel_message_count_ck', sql`${t.messageCount} >= 0`),
    check(
      'PlatformChatChannel_direct_key_ck',
      sql`(${t.type} = 'DIRECT' AND ${t.directKey} IS NOT NULL) OR (${t.type} <> 'DIRECT' AND ${t.directKey} IS NULL)`,
    ),
  ],
);

// scope: primary
export const platformChatChannelMembers = pgTable(
  'PlatformChatChannelMember',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    channelId: uuid('channelId').notNull(),
    staffId: uuid('staffId')
      .notNull()
      .references(() => platformStaff.id, { onDelete: 'restrict' }),
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
    uniqueIndex('PlatformChatChannelMember_channel_staff_uq').on(t.channelId, t.staffId),
    foreignKey({
      name: 'PlatformChatChannelMember_channel_fk',
      columns: [t.channelId],
      foreignColumns: [platformChatChannels.id],
    }).onDelete('cascade'),
    index('PlatformChatChannelMember_staff_pinned_idx').on(t.staffId, t.isPinned),
    index('PlatformChatChannelMember_channel_unread_idx').on(t.channelId, t.unreadCount),
    check('PlatformChatChannelMember_unread_ck', sql`${t.unreadCount} >= 0`),
  ],
);

// scope: primary
export const platformChatMessages = pgTable(
  'PlatformChatMessage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    channelId: uuid('channelId').notNull(),
    senderId: uuid('senderId').notNull(),
    type: chatMessageTypeEnum('type').notNull().default('TEXT'),
    body: text('body').notNull().default(''),
    parentMessageId: uuid('parentMessageId'),
    replyCount: integer('replyCount').notNull().default(0),
    isPinned: boolean('isPinned').notNull().default(false),
    pinnedByStaffId: uuid('pinnedByStaffId'),
    pinnedAt: ts('pinnedAt'),
    editedAt: ts('editedAt'),
    deletedAt: ts('deletedAt'),
    deletedByStaffId: uuid('deletedByStaffId'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('PlatformChatMessage_channel_id_uq').on(t.channelId, t.id),
    foreignKey({
      name: 'PlatformChatMessage_channel_fk',
      columns: [t.channelId],
      foreignColumns: [platformChatChannels.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'PlatformChatMessage_sender_membership_fk',
      columns: [t.channelId, t.senderId],
      foreignColumns: [platformChatChannelMembers.channelId, platformChatChannelMembers.staffId],
    }).onDelete('no action'),
    foreignKey({
      name: 'PlatformChatMessage_pinner_membership_fk',
      columns: [t.channelId, t.pinnedByStaffId],
      foreignColumns: [platformChatChannelMembers.channelId, platformChatChannelMembers.staffId],
    }).onDelete('no action'),
    foreignKey({
      name: 'PlatformChatMessage_deleter_membership_fk',
      columns: [t.channelId, t.deletedByStaffId],
      foreignColumns: [platformChatChannelMembers.channelId, platformChatChannelMembers.staffId],
    }).onDelete('no action'),
    foreignKey({
      name: 'PlatformChatMessage_parent_same_channel_fk',
      columns: [t.channelId, t.parentMessageId],
      foreignColumns: [t.channelId, t.id],
    }).onDelete('no action'),
    index('PlatformChatMessage_channel_timeline_idx').on(t.channelId, t.createdAt, t.id),
    index('PlatformChatMessage_channel_parent_idx').on(t.channelId, t.parentMessageId),
    index('PlatformChatMessage_live_timeline_idx')
      .on(t.channelId, t.createdAt, t.id)
      .where(sql`${t.deletedAt} IS NULL`),
    check('PlatformChatMessage_reply_count_ck', sql`${t.replyCount} >= 0`),
    check(
      'PlatformChatMessage_not_self_parent_ck',
      sql`${t.parentMessageId} IS NULL OR ${t.parentMessageId} <> ${t.id}`,
    ),
  ],
);

// scope: primary
export const platformChatMessageReactions = pgTable(
  'PlatformChatMessageReaction',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    channelId: uuid('channelId').notNull(),
    messageId: uuid('messageId').notNull(),
    staffId: uuid('staffId').notNull(),
    emoji: varchar('emoji', { length: 32 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'PlatformChatMessageReaction_message_scope_fk',
      columns: [t.channelId, t.messageId],
      foreignColumns: [platformChatMessages.channelId, platformChatMessages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'PlatformChatMessageReaction_actor_membership_fk',
      columns: [t.channelId, t.staffId],
      foreignColumns: [platformChatChannelMembers.channelId, platformChatChannelMembers.staffId],
    }).onDelete('no action'),
    uniqueIndex('PlatformChatMessageReaction_message_staff_emoji_uq').on(
      t.messageId,
      t.staffId,
      t.emoji,
    ),
    index('PlatformChatMessageReaction_channel_message_idx').on(t.channelId, t.messageId),
  ],
);

// scope: primary
export const platformChatMessageAttachments = pgTable(
  'PlatformChatMessageAttachment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    channelId: uuid('channelId').notNull(),
    messageId: uuid('messageId').notNull(),
    storageKey: varchar('storageKey', { length: 1024 }).notNull().unique(),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mimeType', { length: 150 }).notNull(),
    sizeBytes: integer('sizeBytes').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'PlatformChatMessageAttachment_message_scope_fk',
      columns: [t.channelId, t.messageId],
      foreignColumns: [platformChatMessages.channelId, platformChatMessages.id],
    }).onDelete('cascade'),
    index('PlatformChatMessageAttachment_message_position_idx').on(t.messageId, t.position),
    check('PlatformChatMessageAttachment_size_ck', sql`${t.sizeBytes} > 0`),
    check('PlatformChatMessageAttachment_position_ck', sql`${t.position} >= 0`),
  ],
);

// scope: primary
export const platformChatMessageMentions = pgTable(
  'PlatformChatMessageMention',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    channelId: uuid('channelId').notNull(),
    messageId: uuid('messageId').notNull(),
    mentionedStaffId: uuid('mentionedStaffId').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'PlatformChatMessageMention_message_scope_fk',
      columns: [t.channelId, t.messageId],
      foreignColumns: [platformChatMessages.channelId, platformChatMessages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'PlatformChatMessageMention_target_membership_fk',
      columns: [t.channelId, t.mentionedStaffId],
      foreignColumns: [platformChatChannelMembers.channelId, platformChatChannelMembers.staffId],
    }).onDelete('no action'),
    uniqueIndex('PlatformChatMessageMention_message_staff_uq').on(t.messageId, t.mentionedStaffId),
    index('PlatformChatMessageMention_staff_created_idx').on(t.mentionedStaffId, t.createdAt),
  ],
);
