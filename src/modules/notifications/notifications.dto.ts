import { z } from 'zod';

export const NOTIFICATION_CATEGORIES = [
  'SECURITY',
  'ACCOUNT',
  'BILLING',
  'TEAM',
  'FILES',
  'SYSTEM',
  'PRODUCT',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_SEVERITIES = ['INFO', 'SUCCESS', 'WARNING', 'CRITICAL'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_DIGESTS = ['NONE', 'DAILY', 'WEEKLY'] as const;
export type NotificationDigest = (typeof NOTIFICATION_DIGESTS)[number];

export const notificationIdParamDto = z.object({
  id: z.string().guid(),
});
export type NotificationIdParamDto = z.infer<typeof notificationIdParamDto>;

export const listNotificationsQueryDto = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((val) => (typeof val === 'string' ? val === 'true' : val))
    .optional(),
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((val) => (typeof val === 'string' ? val === 'true' : val))
    .optional(),
});
export type ListNotificationsQueryDto = z.infer<typeof listNotificationsQueryDto>;

export const readAllNotificationsDto = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
  tenantId: z.string().guid().optional(),
});
export type ReadAllNotificationsDto = z.infer<typeof readAllNotificationsDto>;

export const notificationPreferenceItemDto = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  channelInApp: z.boolean().optional(),
  channelEmail: z.boolean().optional(),
  channelPush: z.boolean().optional(),
  digest: z.enum(NOTIFICATION_DIGESTS).optional(),
  quietHoursStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Must be in HH:mm 24-hour format')
    .nullable()
    .optional(),
  quietHoursEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Must be in HH:mm 24-hour format')
    .nullable()
    .optional(),
  timezone: z.string().max(100).optional(),
});
export type NotificationPreferenceItemDto = z.infer<typeof notificationPreferenceItemDto>;

export const updatePreferencesDto = z.object({
  preferences: z.array(notificationPreferenceItemDto).min(1),
});
export type UpdatePreferencesDto = z.infer<typeof updatePreferencesDto>;

export const pushSubscribeDto = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(500).optional(),
});
export type PushSubscribeDto = z.infer<typeof pushSubscribeDto>;

export const pushUnsubscribeDto = z.object({
  endpoint: z.string().url(),
});
export type PushUnsubscribeDto = z.infer<typeof pushUnsubscribeDto>;

export const broadcastNotificationDto = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(5000),
  category: z.enum(NOTIFICATION_CATEGORIES).default('SYSTEM'),
  severity: z.enum(NOTIFICATION_SEVERITIES).default('INFO'),
  link: z.string().max(500).optional(),
  target: z.object({
    type: z.enum(['ALL', 'TENANT', 'PLAN', 'USERS']),
    tenantId: z.string().guid().optional(),
    planId: z.string().guid().optional(),
    userIds: z.array(z.string().guid()).optional(),
  }),
});
export type BroadcastNotificationDto = z.infer<typeof broadcastNotificationDto>;
