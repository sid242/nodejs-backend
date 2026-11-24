import { z } from 'zod';

export const updateTenantSsoConfigDto = z.object({
  providerType: z.enum(['SAML', 'OIDC']).default('SAML'),
  status: z.enum(['DISABLED', 'ACTIVE']).default('DISABLED'),
  idpEntityId: z.string().trim().min(1, 'Entity ID / Issuer is required').optional().nullable(),
  idpSsoUrl: z.string().url('Must be a valid URL').optional().nullable(),
  idpCertificate: z
    .string()
    .trim()
    .refine(
      (cert) => {
        if (!cert) return true;
        return cert.includes('BEGIN CERTIFICATE') && cert.includes('END CERTIFICATE');
      },
      { message: 'Invalid X.509 certificate: missing BEGIN/END CERTIFICATE header/footer' },
    )
    .optional()
    .nullable(),
  oidcClientId: z.string().trim().optional().nullable(),
  oidcClientSecret: z.string().trim().optional().nullable(),
  oidcDiscoveryUrl: z.string().url('Must be a valid URL').optional().nullable(),
  enforceSso: z.boolean().default(false),
  allowedDomains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'Invalid domain format'),
    )
    .default([]),
  defaultRoleId: z.string().guid().optional().nullable(),
  jitProvisioning: z.boolean().default(true),
});

export const testSsoConnectionDto = z.object({
  providerType: z.enum(['SAML', 'OIDC']),
  idpEntityId: z.string().optional().nullable(),
  idpSsoUrl: z.string().url().optional().nullable(),
  idpCertificate: z
    .string()
    .optional()
    .nullable()
    .refine(
      (cert) => {
        if (!cert) return true;
        return cert.includes('BEGIN CERTIFICATE') && cert.includes('END CERTIFICATE');
      },
      { message: 'Invalid X.509 certificate format' },
    ),
  oidcDiscoveryUrl: z.string().url().optional().nullable(),
});

export const createScimTokenDto = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  expiresInDays: z.number().int().min(1).max(365).optional().default(365),
  allowedIps: z.array(z.string().trim()).optional().default([]),
});

export const rotateScimTokenDto = z.object({
  expiresInDays: z.number().int().min(1).max(365).optional().default(365),
});

export const ssoLookupDto = z.object({
  email: z.string().email('Valid email is required').trim().toLowerCase(),
});

export const ssoInitiateQueryDto = z.object({
  email: z.string().email().trim().toLowerCase().optional(),
  tenantId: z.string().guid().optional(),
  tenantSlug: z.string().trim().optional(),
  returnTo: z.string().trim().optional(),
});

export const samlAcsBodyDto = z.object({
  SAMLResponse: z.string().min(1, 'SAMLResponse is required'),
  RelayState: z.string().optional(),
});

export const oidcCallbackQueryDto = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().min(1, 'State token is required'),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const ssoTenantParamDto = z.object({
  tenantId: z.string().guid('Invalid tenant ID format'),
});

export type UpdateTenantSsoConfigDto = z.infer<typeof updateTenantSsoConfigDto>;
export type TestSsoConnectionDto = z.infer<typeof testSsoConnectionDto>;
export type CreateScimTokenDto = z.input<typeof createScimTokenDto>;
export type RotateScimTokenDto = z.input<typeof rotateScimTokenDto>;
export type SsoLookupDto = z.infer<typeof ssoLookupDto>;
export type SsoInitiateQueryDto = z.infer<typeof ssoInitiateQueryDto>;
export type SamlAcsBodyDto = z.infer<typeof samlAcsBodyDto>;
export type OidcCallbackQueryDto = z.infer<typeof oidcCallbackQueryDto>;
