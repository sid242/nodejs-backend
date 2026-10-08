import { z } from 'zod';

export const updateMeDto = z.object({
  name: z.string().min(1).max(100),
});

export type UpdateMeDto = z.infer<typeof updateMeDto>;

export const listUsersQueryDto = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListUsersQueryDto = z.infer<typeof listUsersQueryDto>;
