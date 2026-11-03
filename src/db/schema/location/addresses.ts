import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { addressOwnerTypeEnum, addressTypeEnum } from '../enums';
import { tenants } from '../tenancy/tenants';

export const addresses = pgTable(
  'Address',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerType: addressOwnerTypeEnum('ownerType').notNull(),
    ownerId: uuid('ownerId').notNull(), // User.id | Tenant.id | TenantMember.id
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }), // null = personal USER address

    type: addressTypeEnum('type').notNull().default('OTHER'),
    label: text('label'),
    isDefault: boolean('isDefault').notNull().default(false),
    recipientName: text('recipientName'),
    phone: text('phone'),

    line1: text('line1').notNull(),
    line2: text('line2'),
    landmark: text('landmark'),
    postalCode: text('postalCode'),
    countryCode: text('countryCode').notNull().default('IN'),

    // Soft references to geo.geo_entities: NO foreign keys (dedicated tenant DBs have no geo schema)
    stateGeoId: bigint('stateGeoId', { mode: 'number' }),
    districtGeoId: bigint('districtGeoId', { mode: 'number' }),
    subdistrictGeoId: bigint('subdistrictGeoId', { mode: 'number' }),
    localityGeoId: bigint('localityGeoId', { mode: 'number' }),
    localityKind: text('localityKind'), // 'CITY' | 'VILLAGE'
    areaGeoId: bigint('areaGeoId', { mode: 'number' }),

    // Name snapshots (survive geo refreshes; hold free text for non-India addresses)
    stateName: text('stateName'),
    districtName: text('districtName'),
    subdistrictName: text('subdistrictName'),
    localityName: text('localityName'),
    areaName: text('areaName'),

    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),

    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deletedAt', { precision: 3, mode: 'date' }),
  },
  (t) => [
    index('Address_owner_idx').on(t.ownerType, t.ownerId),
    index('Address_tenantId_idx').on(t.tenantId),
    uniqueIndex('Address_default_unique')
      .on(t.ownerType, t.ownerId, t.type)
      .where(sql`${t.isDefault} = true AND ${t.deletedAt} IS NULL`),
  ],
);

export type Address = typeof addresses.$inferSelect;
export type NewAddress = typeof addresses.$inferInsert;
