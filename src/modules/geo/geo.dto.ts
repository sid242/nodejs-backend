import { z } from 'zod';

export const getChildrenQueryDto = z.object({
  parentId: z.coerce.number().int().positive(),
  level: z.coerce.number().int().min(1).max(7),
  q: z.string().trim().max(100).optional(),
});

export type GetChildrenQuery = z.infer<typeof getChildrenQueryDto>;

export const pinParamDto = z.object({
  pin: z.string().trim().regex(/^[1-9]\d{5}$/, 'Must be a valid 6-digit Indian PIN code'),
});

export type PinParam = z.infer<typeof pinParamDto>;

export const lookupQueryDto = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export type LookupQuery = z.infer<typeof lookupQueryDto>;

