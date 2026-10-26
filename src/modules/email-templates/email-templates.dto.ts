import { z } from 'zod';

export const emailTemplateCategories = [
  'MARKETING',
  'TRANSACTIONAL',
  'NOTIFICATION',
  'CUSTOM',
] as const;

export const emailTemplateStatuses = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

export const templateIdParamDto = z.object({
  id: z.string().uuid(),
});

export type TemplateIdParamDto = z.infer<typeof templateIdParamDto>;

export const createEmailTemplateDto = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[!za-z0-9-]+$/, 'Slug must only contain lowercase alphanumeric characters and hyphens')
    .optional(),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  category: z.enum(emailTemplateCategories).default('CUSTOM'),
  status: z.enum(emailTemplateStatuses).default('DRAFT'),
  description: z.string().trim().max(500).optional(),
  senderName: z.string().trim().max(100).optional().nullable(),
  fromEmail: z
    .string()
    .trim()
    .email('Invalid from email address')
    .optional()
    .nullable()
    .or(z.literal('')),
  replyTo: z
    .string()
    .trim()
    .email('Invalid reply-to email address')
    .optional()
    .nullable()
    .or(z.literal('')),
  htmlContent: z.string().min(1, 'HTML content is required'),
  designJson: z.any().optional(),
  variables: z.array(z.string()).optional(),
});

export type CreateEmailTemplateDto = z.infer<typeof createEmailTemplateDto>;

export const updateEmailTemplateDto = createEmailTemplateDto.partial();
export type UpdateEmailTemplateDto = z.infer<typeof updateEmailTemplateDto>;

export const listEmailTemplatesQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  category: z.enum(emailTemplateCategories).optional(),
  status: z.enum(emailTemplateStatuses).optional(),
});

export type ListEmailTemplatesQueryDto = z.infer<typeof listEmailTemplatesQueryDto>;

export const testSendEmailTemplateDto = z.object({
  to: z.string().email('Valid recipient email required'),
  variables: z.record(z.string(), z.string()).optional().default({}),
});

export type TestSendEmailTemplateDto = z.infer<typeof testSendEmailTemplateDto>;
