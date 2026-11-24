import { z } from 'zod';

export const leadStatusSchema = z.enum([
  'new',
  'contacted',
  'qualified',
  'proposal',
  'won',
  'lost',
]);

export const createLeadDto = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  company: z.string().max(100).optional(),
  status: leadStatusSchema.default('new'),
  value: z.coerce.number().int().min(0).default(0),
  departmentId: z.string().max(50).optional(),
  regionId: z.string().max(50).optional(),
  assignedMemberId: z.string().guid().optional(),
  isConfidential: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
});

export type CreateLeadDto = z.infer<typeof createLeadDto>;

export const updateLeadDto = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  company: z.string().max(100).optional(),
  status: leadStatusSchema.optional(),
  value: z.coerce.number().int().min(0).optional(),
  departmentId: z.string().max(50).optional(),
  regionId: z.string().max(50).optional(),
  assignedMemberId: z.string().guid().nullable().optional(),
  isConfidential: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

export type UpdateLeadDto = z.infer<typeof updateLeadDto>;

export const leadIdParamDto = z.object({
  leadId: z.string().guid(),
});

export type LeadIdParamDto = z.infer<typeof leadIdParamDto>;

export const listLeadsQueryDto = z.object({
  status: leadStatusSchema.optional(),
  departmentId: z.string().optional(),
  regionId: z.string().optional(),
  assignedMemberId: z.string().guid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type ListLeadsQueryDto = z.infer<typeof listLeadsQueryDto>;
