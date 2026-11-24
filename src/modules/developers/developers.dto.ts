import { z } from 'zod';

export const createApiKeyDto = z.object({
  name: z.string().trim().min(1, 'API key name is required').max(50),
  scopes: z.array(z.string().trim()).min(1, 'At least one permission scope is required'),
  expiresInDays: z.number().int().min(1).max(365).optional().default(90),
  rateLimitPerMin: z.number().int().min(10).max(1000).optional().default(60),
  allowedIps: z.array(z.string().trim()).optional().default([]),
});

export type CreateApiKeyDto = z.infer<typeof createApiKeyDto>;

export const listApiKeysQueryDto = z.object({
  status: z.enum(['active', 'revoked', 'expired', 'all']).optional().default('active'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListApiKeysQueryDto = z.infer<typeof listApiKeysQueryDto>;

export const apiKeyIdParamDto = z.object({
  keyId: z.string().guid(),
});

export type ApiKeyIdParamDto = z.infer<typeof apiKeyIdParamDto>;

export const WEBHOOK_SUPPORTED_EVENTS = [
  'member.created',
  'member.updated',
  'member.removed',
  'invitation.accepted',
  'role.changed',
  'file.uploaded',
  'file.deleted',
  'subscription.changed',
  'invoice.paid',
  'invoice.failed',
  'domain.verified',
] as const;

export const createWebhookEndpointDto = z.object({
  url: z.string().trim().url('Must be a valid HTTPS URL'),
  description: z.string().trim().max(200).optional(),
  events: z.array(z.string().trim()).min(1, 'Select at least one event type'),
});

export type CreateWebhookEndpointDto = z.infer<typeof createWebhookEndpointDto>;

export const updateWebhookEndpointDto = z.object({
  url: z.string().trim().url('Must be a valid HTTPS URL').optional(),
  description: z.string().trim().max(200).optional(),
  events: z.array(z.string().trim()).min(1).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

export type UpdateWebhookEndpointDto = z.infer<typeof updateWebhookEndpointDto>;

export const webhookEndpointIdParamDto = z.object({
  endpointId: z.string().guid(),
});

export type WebhookEndpointIdParamDto = z.infer<typeof webhookEndpointIdParamDto>;

export const listDeliveriesQueryDto = z.object({
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'all']).optional().default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListDeliveriesQueryDto = z.infer<typeof listDeliveriesQueryDto>;

export const deliveryIdParamDto = z.object({
  endpointId: z.string().guid(),
  deliveryId: z.string().guid(),
});

export type DeliveryIdParamDto = z.infer<typeof deliveryIdParamDto>;
