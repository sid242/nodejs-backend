import { z } from 'zod';

export const updateMeDto = z.object({
  name: z.string().min(1).max(100).optional(),
  phoneNumber: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        const cleaned = val.replace(/[\s-]/g, '');
        return cleaned === '' ? null : cleaned;
      }
      return val;
    }, z.string().regex(/^\+[1-9]\d{6,14}$/, 'Must be a valid E.164 phone number (e.g. +919876543210)').nullable())
    .optional(),
});

export type UpdateMeDto = z.infer<typeof updateMeDto>;

export const listUsersQueryDto = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListUsersQueryDto = z.infer<typeof listUsersQueryDto>;

export const updateUserStatusDto = z.object({
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
});

export type UpdateUserStatusDto = z.infer<typeof updateUserStatusDto>;

export const userIdParamDto = z.object({
  userId: z.string().uuid(),
});

export type UserIdParamDto = z.infer<typeof userIdParamDto>;
