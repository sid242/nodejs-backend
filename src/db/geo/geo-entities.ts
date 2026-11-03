import { bigint, boolean, pgSchema, smallint, text } from 'drizzle-orm/pg-core';

export const geoSchema = pgSchema('geo');

export const GEO_LEVEL = {
  COUNTRY: 1,
  STATE: 2,
  DISTRICT: 3,
  SUBDISTRICT: 4,
  CITY: 5,
  VILLAGE: 6,
  AREA: 7,
} as const;

export type GeoLevelType = (typeof GEO_LEVEL)[keyof typeof GEO_LEVEL];

export const geoEntities = geoSchema.table('geo_entities', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  levelId: smallint('level_id').notNull(),
  parentId: bigint('parent_id', { mode: 'number' }),
  name: text('name').notNull(),
  localName: text('local_name'),
  source: text('source').notNull(),
  sourceCode: text('source_code'),
  isActive: boolean('is_active').notNull(),
});

export type GeoEntity = typeof geoEntities.$inferSelect;
