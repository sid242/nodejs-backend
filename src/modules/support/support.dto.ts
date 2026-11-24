import { z } from 'zod';

export const createTicketDto = z.object({
  subject: z.string().min(3).max(200),
  description: z.string().min(10),
  category: z.enum(['GENERAL', 'BILLING', 'TECHNICAL', 'SECURITY']).default('GENERAL'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateTicketDto = z.infer<typeof createTicketDto>;

export const addTicketMessageDto = z.object({
  message: z.string().min(1),
  attachments: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type AddTicketMessageDto = z.infer<typeof addTicketMessageDto>;

export const updateTicketDto = z.object({
  status: z.enum(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeStaffId: z.string().guid().nullable().optional(),
});

export type UpdateTicketDto = z.infer<typeof updateTicketDto>;

export const createFeedbackDto = z.object({
  rating: z.number().int().min(1).max(5),
  category: z.enum(['GENERAL', 'BUG', 'FEATURE', 'UI']).default('GENERAL'),
  comment: z.string().min(3).max(2000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateFeedbackDto = z.infer<typeof createFeedbackDto>;
