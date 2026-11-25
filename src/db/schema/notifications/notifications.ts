import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  notificationCategoryEnum,
  notificationDigestEnum,
  notificationSeverityEnum,
  pushChannelEnum,
} from '../enums';
import { users } from '../identity/users';
import { platformStaff } from '../platform/platform-staff';
import { tenantMembers } from '../tenancy/tenant-members';
import { tenants } from '../tenancy/tenants';

// scope: primary
export const notifications = pgTable(
  'Notification',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
    recipientUserId: uuid('recipientUserId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientMemberId: uuid('recipientMemberId').references(() => tenantMembers.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    category: notificationCategoryEnum('category').notNull().default('SYSTEM'),
    severity: notificationSeverityEnum('severity').notNull().default('INFO'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    actorUserId: uuid('actorUserId').references(() => users.id, { onDelete: 'set null' }),
    dedupeKey: text('dedupeKey'),
    readAt: timestamp('readAt', { precision: 3, mode: 'date' }),
    archivedAt: timestamp('archivedAt', { precision: 3, mode: 'date' }),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('Notification_recipient_tenant_read_created_idx').on(
      table.recipientUserId,
      table.tenantId,
      table.readAt,
      table.createdAt,
    ),
    index('Notification_recipient_created_idx').on(table.recipientUserId, table.createdAt),
    index('Notification_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
    uniqueIndex('Notification_recipient_dedupe_idx')
      .on(table.recipientUserId, table.dedupeKey)
      .where(sql`"dedupeKey" IS NOT NULL`),
  ],
);

export type NotificationRecord = typeof notifications.$inferSelect;
export type NewNotificationRecord = typeof notifications.$inferInsert;

// scope: primary
export const notificationPreferences = pgTable(
  'NotificationPreference',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
    category: notificationCategoryEnum('category').notNull(),
    channelInApp: boolean('channelInApp').notNull().default(true),
    channelEmail: boolean('channelEmail').notNull().default(true),
    channelPush: boolean('channelPush').notNull().default(false),
    digest: notificationDigestEnum('digest').notNull().default('NONE'),
    quietHoursStart: text('quietHoursStart'),
    quietHoursEnd: text('quietHoursEnd'),
    timezone: text('timezone').default('UTC'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('NotificationPref_user_tenant_category_idx').on(
      table.userId,
      table.tenantId,
      table.category,
    ),
    index('NotificationPref_userId_idx').on(table.userId),
  ],
);

export type NotificationPreferenceRecord = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreferenceRecord = typeof notificationPreferences.$inferInsert;

// scope: primary
export const pushSubscriptions = pgTable(
  'PushSubscription',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('userId').references(() => users.id, { onDelete: 'cascade' }),
    staffId: uuid('staffId').references(() => platformStaff.id, { onDelete: 'cascade' }),
    channel: pushChannelEnum('channel').notNull().default('webpush'),
    token: text('token'),
    endpoint: text('endpoint'),
    p256dh: text('p256dh'),
    auth: text('auth'),
    platform: text('platform').notNull().default('web'),
    appVersion: text('appVersion'),
    userAgent: text('userAgent'),
    failureCount: integer('failureCount').notNull().default(0),
    disabledAt: timestamp('disabledAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    lastUsedAt: timestamp('lastUsedAt', { precision: 3, mode: 'date' }),
  },
  (table) => [
    index('PushSub_userId_idx').on(table.userId),
    index('PushSub_staffId_idx').on(table.staffId),
    uniqueIndex('PushSub_endpoint_uidx')
      .on(table.endpoint)
      .where(sql`"endpoint" IS NOT NULL`),
    uniqueIndex('PushSub_channel_token_uidx')
      .on(table.channel, table.token)
      .where(sql`"token" IS NOT NULL`),
    check(
      'PushSub_owner_xor_chk',
      sql`(("userId" IS NOT NULL AND "staffId" IS NULL) OR ("userId" IS NULL AND "staffId" IS NOT NULL))`,
    ),
    check(
      'PushSub_channel_creds_chk',
      sql`(("channel" = 'webpush' AND "endpoint" IS NOT NULL AND "p256dh" IS NOT NULL AND "auth" IS NOT NULL) OR ("channel" IN ('fcm', 'apns') AND "token" IS NOT NULL))`,
    ),
    check('PushSub_failure_count_chk', sql`"failureCount" >= 0`),
  ],
);

export type PushSubscriptionRecord = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionRecord = typeof pushSubscriptions.$inferInsert;
