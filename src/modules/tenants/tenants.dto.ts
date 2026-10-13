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
