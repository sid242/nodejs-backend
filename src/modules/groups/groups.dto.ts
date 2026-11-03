import { z } from 'zod';

export const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const groupSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Slug must be at least 2 characters long')
  .max(100, 'Slug cannot exceed 100 characters')
  .regex(slugRegex, 'Slug must contain only lowercase alphanumeric characters and single hyphens');

export const createGroupDto = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name cannot exceed 100 characters'),
  slug: groupSlugSchema.optional(),
  description: z.string().trim().max(500, 'Description cannot exceed 500 characters').optional().nullable(),
});

export type CreateGroupInput = z.infer<typeof createGroupDto>;

export const updateGroupDto = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty').max(100, 'Name cannot exceed 100 characters').optional(),
    slug: groupSlugSchema.optional(),
    description: z.string().trim().max(500, 'Description cannot exceed 500 characters').optional().nullable(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided to update',
  });

export type UpdateGroupInput = z.infer<typeof updateGroupDto>;

export const listGroupsQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type ListGroupsQuery = z.infer<typeof listGroupsQueryDto>;

export const groupIdParamDto = z.object({
  groupId: z.string().trim().uuid('Invalid group ID format'),
});

export type GroupIdParam = z.infer<typeof groupIdParamDto>;

export const groupMemberParamsDto = z.object({
  groupId: z.string().trim().uuid('Invalid group ID format'),
  userId: z.string().trim().uuid('Invalid user ID format'),
});

export type GroupMemberParams = z.infer<typeof groupMemberParamsDto>;

export const platformGroupMemberParamsDto = z.object({
  groupId: z.string().trim().uuid('Invalid group ID format'),
  staffId: z.string().trim().uuid('Invalid staff ID format'),
});

export type PlatformGroupMemberParams = z.infer<typeof platformGroupMemberParamsDto>;

export const addTenantGroupMembersDto = z.object({
  userIds: z
    .array(z.string().trim().uuid('Invalid user ID'))
    .min(1, 'At least one user ID is required')
    .max(100, 'Cannot add more than 100 members at once')
    .transform((ids) => Array.from(new Set(ids))),
});

export type AddTenantGroupMembersInput = z.infer<typeof addTenantGroupMembersDto>;

export const addPlatformGroupMembersDto = z.object({
  staffIds: z
    .array(z.string().trim().uuid('Invalid staff ID'))
    .min(1, 'At least one staff ID is required')
    .max(100, 'Cannot add more than 100 members at once')
    .transform((ids) => Array.from(new Set(ids))),
});

export type AddPlatformGroupMembersInput = z.infer<typeof addPlatformGroupMembersDto>;

