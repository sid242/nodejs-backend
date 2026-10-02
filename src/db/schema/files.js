import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { fileStatusEnum } from './enums.js';
import { users } from './users.js';

export const files = pgTable(
  'File',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(),
    filename: text('filename').notNull(),
    contentType: text('contentType').notNull(),
    size: integer('size'),
    status: fileStatusEnum('status').notNull().default('PENDING'),
    ownerId: uuid('ownerId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('File_ownerId_createdAt_idx').on(table.ownerId, table.createdAt),
    index('File_status_createdAt_idx').on(table.status, table.createdAt),
  ],
);
