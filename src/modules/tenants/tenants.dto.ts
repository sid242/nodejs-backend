import { z } from 'zod';

export const RESERVED_SLUGS = [
  'www',
  'api',
  'app',
  'admin',
  'platform',
  'auth',
  'login',
  'register',
  'logout',
  'accept-invite',
  'onboarding',
  'settings',
  'w',
  'static',
  'assets',
  'cdn',
  'mail',
  'smtp',
  'imap',
  'ftp',
  'status',
  'docs',
  'help',
  'support',
  'billing',
  'pricing',
  'dashboard',
  'health',
  'metrics',
] as const;

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug.toLowerCase());
}

export const tenantSlugSchema = z
  .string()
  .trim()
  .min(3, 'Slug must be at least 3 characters long')
  .max(63, 'Slug cannot exceed 63 characters')
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/,
    'Slug must follow DNS label rules (lowercase alphanumeric and hyphens, cannot start or end with hyphen)',
  )
  .refine((s) => s.slice(2, 4) !== '--', {
    message: 'Slug cannot contain double hyphens at index 2-3 (punycode reserved)',
  })
  .refine((s) => !isReservedSlug(s), {
    message: 'This workspace slug is reserved and cannot be used',
  });

export const createTenantDto = z
  .object({
    name: z.string().trim().min(2).max(100),
    slug: tenantSlugSchema,
  })
  .strict();

export type CreateTenantDto = z.infer<typeof createTenantDto>;

export const updateTenantDto = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    slug: tenantSlugSchema.optional(),
  })
  .strict();

export type UpdateTenantDto = z.infer<typeof updateTenantDto>;

export const addMemberDto = z.object({
  email: z.string().trim().email(),
  role: z.string().trim().min(2).max(50).default('MEMBER'),
});

export type AddMemberDto = z.infer<typeof addMemberDto>;

export const updateMemberRoleDto = z.object({
  role: z.string().trim().min(2).max(50),
});

export type UpdateMemberRoleDto = z.infer<typeof updateMemberRoleDto>;

export const updateMemberStatusDto = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});

export type UpdateMemberStatusDto = z.infer<typeof updateMemberStatusDto>;

export const bulkInviteMembersDto = z.object({
  invites: z
    .array(
      z.object({
        email: z.string().trim().email(),
        role: z.string().trim().min(2).max(50).default('MEMBER'),
      }),
    )
    .min(1, 'At least one invite is required')
    .max(50, 'Cannot invite more than 50 members in a single request'),
});

export type BulkInviteMembersDto = z.infer<typeof bulkInviteMembersDto>;

export const upsertTenantEmailConfigDto = z.object({
  host: z.string().trim().min(1, 'SMTP host is required'),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: z.string().trim().min(1, 'SMTP username is required'),
  password: z.string().min(1).optional(),
  fromEmail: z.string().trim().email('Valid from email address is required'),
  fromName: z.string().trim().max(100).optional(),
  replyTo: z.string().trim().email().optional(),
  isEnabled: z.boolean().default(true),
});

export type UpsertTenantEmailConfigDto = z.infer<typeof upsertTenantEmailConfigDto>;

export const testTenantEmailConfigDto = z.object({
  host: z.string().trim().optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().trim().optional(),
  password: z.string().optional(),
  fromEmail: z.string().trim().email().optional(),
  fromName: z.string().trim().max(100).optional(),
  targetEmail: z.string().trim().email().optional(),
});

export type TestTenantEmailConfigDto = z.infer<typeof testTenantEmailConfigDto>;

export const resolvePublicTenantDto = z.object({
  slug: z.string().trim().optional(),
  domain: z.string().trim().optional(),
  host: z.string().trim().optional(),
});

export type ResolvePublicTenantDto = z.infer<typeof resolvePublicTenantDto>;

const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const updateTenantBrandingDto = z.object({
  companyName: z.string().trim().max(100).optional().nullable(),
  logoUrl: z.string().trim().url().optional().or(z.literal('')).nullable(),
  logoDarkUrl: z.string().trim().url().optional().or(z.literal('')).nullable(),
  faviconUrl: z.string().trim().url().optional().or(z.literal('')).nullable(),
  primaryColor: z.string().trim().regex(hexColorRegex, 'Invalid hex color code').optional(),
  accentColor: z.string().trim().regex(hexColorRegex, 'Invalid hex color code').optional(),
  borderRadius: z.string().trim().max(20).optional().nullable(),
  customDomain: z
    .string()
    .trim()
    .max(255)
    .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Must be a valid domain name')
    .optional()
    .nullable()
    .or(z.literal('')),
  supportEmail: z.string().trim().email().optional().nullable().or(z.literal('')),
});

export type UpdateTenantBrandingDto = z.infer<typeof updateTenantBrandingDto>;

export const updateTenantUrlSettingsDto = z.object({
  urlStyle: z.enum(['path', 'subdomain', 'customDomain']).optional(),
  customDomain: z
    .string()
    .trim()
    .max(255)
    .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Must be a valid domain name')
    .optional()
    .nullable()
    .or(z.literal('')),
});

export type UpdateTenantUrlSettingsDto = z.infer<typeof updateTenantUrlSettingsDto>;

export const overrideTenantCustomDomainDto = z.object({
  customDomain: z
    .string()
    .trim()
    .max(255)
    .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Must be a valid domain name')
    .optional(),
  status: z.enum(['PENDING', 'VERIFIED', 'FAILED']).default('VERIFIED'),
  reason: z.string().trim().max(300).optional(),
});

export type OverrideTenantCustomDomainDto = z.infer<typeof overrideTenantCustomDomainDto>;

export const ALLOWED_BRANDING_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/ico',
  'image/icon',
  'image/x-ico',
  'application/octet-stream',
  'application/x-ico',
] as const;

export const requestBrandingUploadUrlDto = z.object({
  type: z.enum(['logo', 'logo-dark', 'favicon']),
  filename: z.string().trim().min(1),
  contentType: z
    .string()
    .trim()
    .refine(
      (val) =>
        (ALLOWED_BRANDING_MIME_TYPES as readonly string[]).includes(val) ||
        val.startsWith('image/'),
      {
        message:
          'Invalid content type. Must be a valid image format (PNG, JPEG, WebP, SVG, or ICO).',
      },
    ),
});

export type RequestBrandingUploadUrlDto = z.infer<typeof requestBrandingUploadUrlDto>;

export const searchAuditLogsDto = z.object({
  search: z.string().trim().optional(),
  action: z.string().trim().optional(),
  actions: z.array(z.string().trim()).optional(),
  entityType: z.string().trim().optional(),
  status: z.enum(['SUCCESS', 'WARNING', 'FAILED', 'ALL']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type SearchAuditLogsDto = z.infer<typeof searchAuditLogsDto>;

export const acceptInviteDto = z.object({
  token: z.string().min(1),
  tenantId: z.string().uuid().optional(),
});

export type AcceptInviteDto = z.infer<typeof acceptInviteDto>;

export const transferOwnershipDto = z.object({
  newRoleForFormerOwner: z.string().trim().default('ADMIN'),
});

export type TransferOwnershipDto = z.infer<typeof transferOwnershipDto>;

export const verifyCustomDomainDto = z.object({
  bypassVerification: z.boolean().optional(),
});

export type VerifyCustomDomainDto = z.infer<typeof verifyCustomDomainDto>;
