import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { announcementAudienceEnum, announcementSeverityEnum, announcementStatusEnum } from '../enums';
import { platformStaff } from '../platform/platform-staff';
import { users } from '../identity/users';

export const announcements = pgTable(
  'Announcement',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    severity: announcementSeverityEnum('severity').notNull().default('INFO'),
    audience: announcementAudienceEnum('audience').notNull().default('ALL'),
    audienceFilter: jsonb('audienceFilter'),
    startsAt: timestamp('startsAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    endsAt: timestamp('endsAt', { precision: 3, mode: 'date' }),
    dismissible: boolean('dismissible').notNull().default(true),
    link: text('link'),
    status: announcementStatusEnum('status').notNull().default('LIVE'),
    createdByStaffId: uuid('createdByStaffId').references(() => platformStaff.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('Announcement_status_startsAt_endsAt_idx').on(table.status, table.startsAt, table.endsAt),
    index('Announcement_audience_idx').on(table.audience),
  ],
);

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;

export const announcementDismissals = pgTable(
  'AnnouncementDismissal',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    announcementId: uuid('announcementId')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('AnnouncementDismissal_announcement_user_idx').on(table.announcementId, table.userId),
    index('AnnouncementDismissal_userId_idx').on(table.userId),
  ],
);

export type AnnouncementDismissal = typeof announcementDismissals.$inferSelect;
export type NewAnnouncementDismissal = typeof announcementDismissals.$inferInsert;

export const changelogEntries = pgTable(
  'ChangelogEntry',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    version: text('version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    tags: text('tags').array(),
    publishedAt: timestamp('publishedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('ChangelogEntry_publishedAt_idx').on(table.publishedAt),
    uniqueIndex('ChangelogEntry_version_idx').on(table.version),
  ],
);

export type ChangelogEntry = typeof changelogEntries.$inferSelect;
export type NewChangelogEntry = typeof changelogEntries.$inferInsert;
