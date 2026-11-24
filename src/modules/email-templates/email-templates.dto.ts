import { z } from 'zod';

export const emailTemplateCategories = [
  'MARKETING',
  'TRANSACTIONAL',
  'NOTIFICATION',
  'CUSTOM',
] as const;

export const emailTemplateStatuses = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

export const emailDeliveryStatuses = [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED',
] as const;

export const emailSuppressionReasons = ['BOUNCE', 'COMPLAINT', 'UNSUBSCRIBE', 'MANUAL'] as const;

export const templateIdParamDto = z.object({
  id: z.string().uuid(),
});

export type TemplateIdParamDto = z.infer<typeof templateIdParamDto>;

export const templateIdAndVersionParamDto = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().min(1),
});

export type TemplateIdAndVersionParamDto = z.infer<typeof templateIdAndVersionParamDto>;

export const suppressionIdParamDto = z.object({
  id: z.string().uuid(),
});

export type SuppressionIdParamDto = z.infer<typeof suppressionIdParamDto>;

export const deliveryLogIdParamDto = z.object({
  id: z.string().uuid(),
});

export type DeliveryLogIdParamDto = z.infer<typeof deliveryLogIdParamDto>;

export const createEmailTemplateDto = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase alphanumeric characters and hyphens')
    .optional(),
  locale: z.string().trim().min(2).max(10).default('en'),
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
  isSystemOverride: z.boolean().optional().default(false),
});

export type CreateEmailTemplateDto = z.infer<typeof createEmailTemplateDto>;
export type CreateEmailTemplateInput = z.input<typeof createEmailTemplateDto>;

export const updateEmailTemplateDto = createEmailTemplateDto.partial();
export type UpdateEmailTemplateDto = z.infer<typeof updateEmailTemplateDto>;

export const listEmailTemplatesQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  category: z.enum(emailTemplateCategories).optional(),
  status: z.enum(emailTemplateStatuses).optional(),
  locale: z.string().trim().optional(),
});

export type ListEmailTemplatesQueryDto = z.infer<typeof listEmailTemplatesQueryDto>;

export const testSendEmailTemplateDto = z.object({
  to: z.string().email('Valid recipient email required'),
  variables: z.record(z.string(), z.any()).optional().default({}),
});

export type TestSendEmailTemplateDto = z.infer<typeof testSendEmailTemplateDto>;

export const listDeliveryLogsQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(emailDeliveryStatuses).optional(),
  to: z.string().trim().optional(),
  search: z.string().trim().optional(),
});

export type ListDeliveryLogsQueryDto = z.infer<typeof listDeliveryLogsQueryDto>;

export const listSuppressionsQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  reason: z.enum(emailSuppressionReasons).optional(),
  search: z.string().trim().optional(),
});

export type ListSuppressionsQueryDto = z.infer<typeof listSuppressionsQueryDto>;

export const createSuppressionDto = z.object({
  email: z.string().trim().email('Valid email address required'),
  reason: z.enum(emailSuppressionReasons).default('MANUAL'),
  details: z.string().trim().max(500).optional(),
});

export type CreateSuppressionDto = z.infer<typeof createSuppressionDto>;

export const bounceWebhookDto = z.object({
  Type: z.string().optional(),
  Message: z.string().optional(),
  MessageId: z.string().optional(),
  TopicArn: z.string().optional(),
  Subject: z.string().optional(),
  Timestamp: z.string().optional(),
  SignatureVersion: z.string().optional(),
  Signature: z.string().optional(),
  SigningCertURL: z.string().optional(),
  UnsubscribeURL: z.string().optional(),
  SubscribeURL: z.string().optional(),
  Token: z.string().optional(),
  email: z.string().email().optional(),
  notificationType: z.string().optional(),
  bounce: z.any().optional(),
  complaint: z.any().optional(),
  reason: z.string().optional(),
  details: z.string().optional(),
  tenantId: z.string().uuid().optional(),
});

export type BounceWebhookDto = z.infer<typeof bounceWebhookDto>;
