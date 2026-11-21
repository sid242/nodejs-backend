import { z } from 'zod';

export const recordUsageEventDto = z.object({
  meter: z.enum([
    'members.active',
    'storage.bytes',
    'api.requests',
    'emails.sent',
    'webhooks.deliveries',
    'sso.logins',
  ]),
  quantity: z.number().int().positive().default(1),
  unit: z.string().optional().default('count'),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export type RecordUsageEventDto = z.infer<typeof recordUsageEventDto>;

export const listUsageQueryDto = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  meter: z.string().optional(),
});

export type ListUsageQueryDto = z.infer<typeof listUsageQueryDto>;

export const analyticsOverviewQueryDto = z.object({
  range: z.enum(['7d', '30d', '90d']).optional().default('30d'),
});

export type AnalyticsOverviewQueryDto = z.infer<typeof analyticsOverviewQueryDto>;

export const listActivityQueryDto = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
  entityType: z.enum(['MEMBER', 'ROLE', 'FILE', 'WORKSPACE', 'BILLING', 'SECURITY']).optional(),
});

export type ListActivityQueryDto = z.infer<typeof listActivityQueryDto>;

export const createReportDefinitionDto = z.object({
  name: z.string().min(1, 'Report name is required').max(100),
  type: z.enum(['MEMBERS', 'AUDIT', 'USAGE', 'FILES', 'BILLING', 'SECURITY']),
  filters: z.record(z.any()).optional().default({}),
  columns: z.array(z.string()).optional().default([]),
  format: z.enum(['CSV', 'JSON']).optional().default('CSV'),
  schedule: z.string().optional(),
  recipients: z.array(z.string().email()).optional().default([]),
});

export type CreateReportDefinitionDto = z.infer<typeof createReportDefinitionDto>;

export const listReportsQueryDto = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  page: z.coerce.number().int().min(1).optional().default(1),
});

export type ListReportsQueryDto = z.infer<typeof listReportsQueryDto>;
