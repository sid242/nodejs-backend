import { z } from 'zod';

export const updateTenantSsoConfigDto = z.object({
  providerType: z.enum(['SAML', 'OIDC']).default('SAML'),
  status: z.enum(['DISABLED', 'ACTIVE']).default('DISABLED'),
  idpEntityId: z.string().trim().min(1, 'Entity ID / Issuer is required').optional().nullable(),
  idpSsoUrl: z.string().url('Must be a valid URL').optional().nullable(),
  idpCertificate: z.string().trim().optional().nullable(),
  oidcClientId: z.string().trim().optional().nullable(),
  oidcClientSecret: z.string().trim().optional().nullable(),
  oidcDiscoveryUrl: z.string().url('Must be a valid URL').optional().nullable(),
  enforceSso: z.boolean().default(false),
  allowedDomains: z.array(z.string().trim().toLowerCase()).default([]),
  defaultRoleId: z.string().uuid().optional().nullable(),
  jitProvisioning: z.boolean().default(true),
});

export const testSsoConnectionDto = z.object({
  providerType: z.enum(['SAML', 'OIDC']),
  idpEntityId: z.string().optional().nullable(),
  idpSsoUrl: z.string().url().optional().nullable(),
  idpCertificate: z.string().optional().nullable(),
  oidcDiscoveryUrl: z.string().url().optional().nullable(),
});

export const createScimTokenDto = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  expiresInDays: z.number().int().min(1).max(365).optional().nullable(),
});

export const ssoLookupDto = z.object({
  email: z.string().email('Valid email is required').trim().toLowerCase(),
});

export const ssoInitiateQueryDto = z.object({
  email: z.string().email().trim().toLowerCase().optional(),
  tenantId: z.string().uuid().optional(),
  tenantSlug: z.string().trim().optional(),
  returnTo: z.string().trim().optional(),
});

export const ssoAcsBodyDto = z.object({
  SAMLResponse: z.string().optional(),
  RelayState: z.string().optional(),
  code: z.string().optional(),
  state: z.string().optional(),
});

export type UpdateTenantSsoConfigDto = z.infer<typeof updateTenantSsoConfigDto>;
export type TestSsoConnectionDto = z.infer<typeof testSsoConnectionDto>;
export type CreateScimTokenDto = z.infer<typeof createScimTokenDto>;
export type SsoLookupDto = z.infer<typeof ssoLookupDto>;
export type SsoInitiateQueryDto = z.infer<typeof ssoInitiateQueryDto>;
export type SsoAcsBodyDto = z.infer<typeof ssoAcsBodyDto>;

