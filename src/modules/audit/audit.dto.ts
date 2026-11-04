import { z } from 'zod';

export const searchAuditLogsQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  actorUserId: z.string().uuid().optional(),
  effectiveUserId: z.string().uuid().optional(),
  action: z.string().optional(),
  actions: z.array(z.string()).optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  result: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  source: z.enum(['DIRECT', 'GROUP', 'IMPERSONATION', 'SYSTEM', 'JOB']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  requestId: z.string().optional(),
  correlationId: z.string().optional(),
  search: z.string().optional(),
});

export type SearchAuditLogsQueryDto = z.infer<typeof searchAuditLogsQueryDto>;

export const exportAuditLogsQueryDto = searchAuditLogsQueryDto.extend({
  format: z.enum(['csv', 'json']).default('csv'),
});

export type ExportAuditLogsQueryDto = z.infer<typeof exportAuditLogsQueryDto>;

export const updateTenantAuditPolicyDto = z.object({
  retentionDays: z.coerce.number().int().min(7).max(3650),
  exportAllowed: z.boolean().optional(),
  complianceFramework: z.string().min(2).max(50).optional(),
});

export type UpdateTenantAuditPolicyDto = z.infer<typeof updateTenantAuditPolicyDto>;

export const simulateAccessDto = z.object({
  userId: z.string().uuid({ message: 'Valid user ID is required' }),
  permission: z.string().min(1, { message: 'Permission key is required' }),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
});

export type SimulateAccessDto = z.infer<typeof simulateAccessDto>;

export const getEffectiveAccessQueryDto = z.object({
  userId: z.string().uuid({ message: 'Valid user ID is required' }),
});

export type GetEffectiveAccessQueryDto = z.infer<typeof getEffectiveAccessQueryDto>;

