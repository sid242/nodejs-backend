import { z } from 'zod';

import { SUPPORTED_LOCALES } from '@/lib/i18n';

export const updateMeDto = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().max(50).nullable().optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  timezone: z.string().min(1).max(50).optional(),
  dateFormat: z.string().min(1).max(20).optional(),
  avatarUrl: z.string().url('Must be a valid URL').nullable().optional(),
  phoneNumber: z
    .preprocess(
      (val) => {
        if (typeof val === 'string') {
          const cleaned = val.replace(/[\s-]/g, '');
          return cleaned === '' ? null : cleaned;
        }
        return val;
      },
      z
        .string()
        .regex(/^\+[1-9]\d{6,14}$/, 'Must be a valid E.164 phone number (e.g. +919876543210)')
        .nullable(),
    )
    .optional(),
});

export type UpdateMeDto = z.infer<typeof updateMeDto>;

export const listLoginHistoryQueryDto = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListLoginHistoryQueryDto = z.infer<typeof listLoginHistoryQueryDto>;

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

export const avatarUploadUrlDto = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif'], {
    message: 'Avatar must be a JPEG, PNG, WebP, or GIF image',
  }),
  filename: z.string().trim().max(100).optional().default('avatar.png'),
});

export type AvatarUploadUrlDto = z.infer<typeof avatarUploadUrlDto>;

export const requestEmailChangeDto = z.object({
  newEmail: z.string().trim().email('Must be a valid email address').toLowerCase(),
});

export type RequestEmailChangeDto = z.infer<typeof requestEmailChangeDto>;

export const confirmEmailChangeDto = z.object({
  token: z.string().trim().min(1, 'Verification token is required'),
});

export type ConfirmEmailChangeDto = z.infer<typeof confirmEmailChangeDto>;

export const revertEmailChangeDto = z.object({
  token: z.string().trim().min(1, 'Revert token is required'),
});

export type RevertEmailChangeDto = z.infer<typeof revertEmailChangeDto>;
