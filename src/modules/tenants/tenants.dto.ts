import { z } from 'zod';

export const createTenantDto = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase alphanumeric characters and hyphens'),
  plan: z.enum(['FREE', 'PRO', 'ENTERPRISE']).default('FREE'),
});

export type CreateTenantDto = z.infer<typeof createTenantDto>;

export const updateTenantDto = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  plan: z.enum(['FREE', 'PRO', 'ENTERPRISE']).optional(),
});

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
