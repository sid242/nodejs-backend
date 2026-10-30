import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { customDomainStatusEnum } from '../enums';
import { tenants } from './tenants';

export const tenantBrandings = pgTable(
  'TenantBranding',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyName: text('companyName'),
    logoUrl: text('logoUrl'),
    logoDarkUrl: text('logoDarkUrl'),
    faviconUrl: text('faviconUrl'),
    primaryColor: text('primaryColor').notNull().default('#4F46E5'),
    accentColor: text('accentColor').notNull().default('#06B6D4'),
    secondaryColor: text('secondaryColor'),
    primaryDarkColor: text('primaryDarkColor'),
    accentDarkColor: text('accentDarkColor'),
    secondaryDarkColor: text('secondaryDarkColor'),
    fontFamily: text('fontFamily').notNull().default('Inter'),
    sidebarTheme: text('sidebarTheme').notNull().default('DARK'),
    borderRadius: text('borderRadius').notNull().default('0.5rem'),
    customDomain: text('customDomain'),
    customDomainStatus: customDomainStatusEnum('customDomainStatus').notNull().default('PENDING'),
    customDomainVerifiedAt: timestamp('customDomainVerifiedAt', { precision: 3, mode: 'date' }),
    customDomainTlsStatus: text('customDomainTlsStatus'),
    supportEmail: text('supportEmail'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('TenantBranding_tenantId_unique').on(table.tenantId),
    uniqueIndex('TenantBranding_customDomain_unique').on(table.customDomain),
  ],
);

export type TenantBranding = typeof tenantBrandings.$inferSelect;
export type NewTenantBranding = typeof tenantBrandings.$inferInsert;

export const publicTenantBranding = {
  id: tenantBrandings.id,
  tenantId: tenantBrandings.tenantId,
  companyName: tenantBrandings.companyName,
  logoUrl: tenantBrandings.logoUrl,
  logoDarkUrl: tenantBrandings.logoDarkUrl,
  faviconUrl: tenantBrandings.faviconUrl,
  primaryColor: tenantBrandings.primaryColor,
  accentColor: tenantBrandings.accentColor,
  secondaryColor: tenantBrandings.secondaryColor,
  primaryDarkColor: tenantBrandings.primaryDarkColor,
  accentDarkColor: tenantBrandings.accentDarkColor,
  secondaryDarkColor: tenantBrandings.secondaryDarkColor,
  fontFamily: tenantBrandings.fontFamily,
  sidebarTheme: tenantBrandings.sidebarTheme,
  borderRadius: tenantBrandings.borderRadius,
  customDomain: tenantBrandings.customDomain,
  customDomainStatus: tenantBrandings.customDomainStatus,
  customDomainVerifiedAt: tenantBrandings.customDomainVerifiedAt,
  customDomainTlsStatus: tenantBrandings.customDomainTlsStatus,
  supportEmail: tenantBrandings.supportEmail,
  createdAt: tenantBrandings.createdAt,
  updatedAt: tenantBrandings.updatedAt,
};

export type PublicTenantBranding = typeof tenantBrandings.$inferSelect;
