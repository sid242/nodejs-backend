import { z } from 'zod';

export const onboardingSessionSchema = z.object({});

export const completeOnboardingSchema = z.object({
  state: z.string().min(1, 'State is required'),
  code: z.string().optional(),
  accessToken: z.string().optional(),
  wabaId: z.string().min(1, 'WABA ID is required'),
  phoneNumberId: z.string().optional(),
  displayName: z.string().optional(),
});

export const updatePhoneNumberSchema = z.object({
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const templateComponentParameterSchema = z.object({
  type: z.enum(['text', 'currency', 'date_time', 'image', 'document', 'video']),
  text: z.string().optional(),
  image: z.object({ link: z.string().optional(), id: z.string().optional() }).optional(),
  document: z
    .object({
      link: z.string().optional(),
      id: z.string().optional(),
      filename: z.string().optional(),
    })
    .optional(),
  video: z.object({ link: z.string().optional(), id: z.string().optional() }).optional(),
});

export const templateComponentInputSchema = z.object({
  type: z.enum(['header', 'body', 'button']),
  sub_type: z.enum(['quick_reply', 'url']).optional(),
  index: z.number().int().optional(),
  parameters: z.array(templateComponentParameterSchema),
});

export const createTemplateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[a-z0-9_]+$/, 'Template name must be lowercase alphanumeric with underscores'),
  category: z.enum(['AUTHENTICATION', 'UTILITY', 'MARKETING']),
  language: z.string().default('en'),
  components: z.array(z.record(z.string(), z.unknown())),
});

export const updateTemplateSchema = z.object({
  category: z.enum(['AUTHENTICATION', 'UTILITY', 'MARKETING']).optional(),
  components: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const sendTemplateMessageSchema = z.object({
  phoneNumberId: z.string().optional(),
  to: z.string().min(7, 'Recipient phone number is required'),
  template: z.object({
    name: z.string().min(1),
    language: z.string().default('en'),
    components: z.array(templateComponentInputSchema).optional(),
  }),
  idempotencyKey: z.string().optional(),
});

export const sendTextMessageSchema = z.object({
  phoneNumberId: z.string().optional(),
  to: z.string().min(7, 'Recipient phone number is required'),
  text: z.string().min(1).max(4096),
  previewUrl: z.boolean().optional(),
  idempotencyKey: z.string().optional(),
});

export const sendMediaMessageSchema = z.object({
  phoneNumberId: z.string().optional(),
  to: z.string().min(7, 'Recipient phone number is required'),
  type: z.enum(['image', 'document', 'video', 'audio']),
  media: z.object({
    id: z.string().optional(),
    link: z.string().url().optional(),
    caption: z.string().optional(),
    filename: z.string().optional(),
  }),
  idempotencyKey: z.string().optional(),
});

export const sendOtpSchema = z.object({
  phoneNumber: z.string().min(7, 'Phone number is required'),
  purpose: z
    .enum(['LOGIN', 'SIGNUP', 'PHONE_VERIFICATION', 'PASSWORD_RESET', 'SENSITIVE_ACTION'])
    .default('LOGIN'),
});

export const verifyOtpSchema = z.object({
  phoneNumber: z.string().min(7, 'Phone number is required'),
  purpose: z
    .enum(['LOGIN', 'SIGNUP', 'PHONE_VERIFICATION', 'PASSWORD_RESET', 'SENSITIVE_ACTION'])
    .default('LOGIN'),
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

export const conversationReplySchema = z.object({
  text: z.string().min(1).max(4096),
});

export const conversationAssignmentSchema = z.object({
  staffId: z.string().uuid().nullable(),
});

export const contactConsentSchema = z.object({
  purpose: z.enum(['AUTHENTICATION', 'TRANSACTIONAL', 'MARKETING']),
  status: z.enum(['OPTED_IN', 'OPTED_OUT']),
  consentSource: z.string().default('ADMIN'),
});

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(255),
  templateId: z.string().uuid(),
  phoneNumberId: z.string().trim().min(1).optional(),
  recipients: z
    .array(
      z.object({
        phoneNumber: z.string().min(7),
        displayName: z.string().optional(),
        parameters: z.record(z.string(), z.string()).optional(),
      }),
    )
    .min(1, 'At least one recipient is required'),
});

export const scheduleCampaignSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
});
