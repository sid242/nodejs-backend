import { z } from 'zod';

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export const fileIdParamDto = z.object({
  id: z.string().uuid(),
});

export const requestUploadDto = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.enum(ALLOWED_TYPES),
});
