import { relations } from 'drizzle-orm';
import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { roles } from '../access/rbac';
import { users } from '../identity/users';
import { tenants } from './tenants';

export const ssoProviderTypeEnum = pgEnum('sso_provider_type', ['SAML', 'OIDC']);
export const ssoStatusEnum = pgEnum('sso_status', ['DISABLED', 'ACTIVE']);
export const scimTokenStatusEnum = pgEnum('scim_token_status', ['ACTIVE', 'REVOKED']);

/**
 * Tenant Enterprise SSO Configuration (SAML 2.0 / OIDC)
 */
export const tenantSsoConfigs = pgTable(
  'tenant_sso_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    providerType: ssoProviderTypeEnum('provider_type').notNull().default('SAML'),
    status: ssoStatusEnum('status').notNull().default('DISABLED'),
    idpEntityId: text('idp_entity_id'),
    idpSsoUrl: text('idp_sso_url'),
    idpCertificate: text('idp_certificate'),
    oidcClientId: text('oidc_client_id'),
    oidcClientSecret: text('oidc_client_secret'),
    oidcDiscoveryUrl: text('oidc_discovery_url'),
    enforceSso: boolean('enforce_sso').notNull().default(false),
    allowedDomains: text('allowed_domains')
      .array()
      .notNull()
      .default([]),
    defaultRoleId: uuid('default_role_id').references(() => roles.id, {
      onDelete: 'set null',
    }),
    jitProvisioning: boolean('jit_provisioning').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('tenant_sso_configs_tenant_id_unique').on(table.tenantId)],
);

/**
 * Tenant SCIM 2.0 Bearer Tokens
 */
export const tenantScimTokens = pgTable(
  'tenant_scim_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    tokenPrefix: text('token_prefix').notNull(),
    status: scimTokenStatusEnum('status').notNull().default('ACTIVE'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export const tenantSsoRelations = relations(tenantSsoConfigs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantSsoConfigs.tenantId],
    references: [tenants.id],
  }),
  defaultRole: one(roles, {
    fields: [tenantSsoConfigs.defaultRoleId],
    references: [roles.id],
  }),
}));

export const tenantScimTokensRelations = relations(tenantScimTokens, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantScimTokens.tenantId],
    references: [tenants.id],
  }),
  createdByUser: one(users, {
    fields: [tenantScimTokens.createdByUserId],
    references: [users.id],
  }),
}));

export type TenantSsoConfig = typeof tenantSsoConfigs.$inferSelect;
export type NewTenantSsoConfig = typeof tenantSsoConfigs.$inferInsert;
export type TenantScimToken = typeof tenantScimTokens.$inferSelect;
export type NewTenantScimToken = typeof tenantScimTokens.$inferInsert;
