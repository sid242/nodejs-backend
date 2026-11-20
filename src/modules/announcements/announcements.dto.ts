import { z } from 'zod';

export const createAnnouncementDto = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
  severity: z.enum(['INFO', 'MAINTENANCE', 'INCIDENT', 'FEATURE']).default('INFO'),
  audience: z.enum(['ALL', 'PLAN', 'TENANT', 'ROLE']).default('ALL'),
  audienceFilter: z.array(z.string().trim()).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  dismissible: z.boolean().default(true),
  link: z.string().trim().url().optional(),
  status: z.enum(['DRAFT', 'SCHEDULED', 'LIVE', 'ENDED']).default('LIVE'),
});

export type CreateAnnouncementDto = z.infer<typeof createAnnouncementDto>;

export const updateAnnouncementDto = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(10000).optional(),
  severity: z.enum(['INFO', 'MAINTENANCE', 'INCIDENT', 'FEATURE']).optional(),
  audience: z.enum(['ALL', 'PLAN', 'TENANT', 'ROLE']).optional(),
  audienceFilter: z.array(z.string().trim()).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  dismissible: z.boolean().optional(),
  link: z.string().trim().url().optional(),
  status: z.enum(['DRAFT', 'SCHEDULED', 'LIVE', 'ENDED']).optional(),
});

export type UpdateAnnouncementDto = z.infer<typeof updateAnnouncementDto>;

export const createChangelogDto = z.object({
  version: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  tags: z.array(z.string().trim()).optional(),
  publishedAt: z.coerce.date().optional(),
});

export type CreateChangelogDto = z.infer<typeof createChangelogDto>;

export const updateChangelogDto = z.object({
  version: z.string().trim().min(1).max(50).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  tags: z.array(z.string().trim()).optional(),
  publishedAt: z.coerce.date().optional(),
});

export type UpdateChangelogDto = z.infer<typeof updateChangelogDto>;
