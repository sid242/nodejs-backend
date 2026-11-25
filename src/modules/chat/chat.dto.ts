import { z } from 'zod';

export const CHAT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const chatChannelTypeSchema = z.enum(['DIRECT', 'GROUP', 'PUBLIC', 'PRIVATE']);
export const chatCreatableChannelTypeSchema = z.enum(['PUBLIC', 'PRIVATE', 'GROUP']);
export const chatParticipantRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER']);

export const chatAttachmentSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1).max(512),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().min(1),
});

export const channelIdParamDto = z.object({
  channelId: z.string().uuid('Invalid channel ID'),
});

export const messageIdParamDto = z.object({
  channelId: z.string().uuid('Invalid channel ID'),
  messageId: z.string().uuid('Invalid message ID'),
});

export const memberParamDto = z.object({
  channelId: z.string().uuid('Invalid channel ID'),
  memberId: z.string().uuid('Invalid member ID'),
});

export const listContactsQueryDto = z.object({
  q: z.string().trim().max(100).optional(),
});

export const listChannelsQueryDto = z.object({
  includeArchived: z.coerce.boolean().default(false),
  type: chatChannelTypeSchema.optional(),
  q: z.string().trim().max(100).optional(),
});

export const createChannelDto = z.object({
  type: chatCreatableChannelTypeSchema.default('PUBLIC'),
  name: z.string().trim().min(1, 'Channel name is required').max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  topic: z.string().trim().max(255).optional().nullable(),
  memberIds: z.array(z.string().uuid()).max(100).optional().default([]),
});

export const createDirectChannelDto = z.object({
  targetActorId: z.string().uuid('Invalid target user ID'),
});

export const updateChannelDto = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).optional().nullable(),
    topic: z.string().trim().max(255).optional().nullable(),
    isArchived: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const addChannelMembersDto = z.object({
  memberIds: z
    .array(z.string().uuid('Invalid member ID'))
    .min(1, 'Select at least one member')
    .max(50, 'Cannot add more than 50 members at once')
    .transform((ids) => Array.from(new Set(ids))),
});

export const updateChannelMemberRoleDto = z.object({
  role: z.enum(['ADMIN', 'MEMBER']),
});

export const updateChannelPreferencesDto = z
  .object({
    isMuted: z.boolean().optional(),
    isPinned: z.boolean().optional(),
  })
  .refine((data) => data.isMuted !== undefined || data.isPinned !== undefined, {
    message: 'Provide isMuted or isPinned',
  });

export const listMessagesQueryDto = z.object({
  before: z.string().uuid().optional(),
  after: z.string().uuid().optional(),
  parentMessageId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
  pinnedOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sendMessageDto = z
  .object({
    body: z.string().max(4000).default(''),
    parentMessageId: z.string().uuid().optional().nullable(),
    mentions: z.array(z.string().uuid()).max(50).optional().default([]),
    attachments: z.array(chatAttachmentSchema).max(10).optional().default([]),
  })
  .refine((data) => data.body.trim().length > 0 || data.attachments.length > 0, {
    message: 'Message must contain text or at least one attachment',
  });

export const updateMessageDto = z.object({
  body: z.string().trim().min(1, 'Message body cannot be empty').max(4000),
  mentions: z.array(z.string().uuid()).max(50).optional(),
});

export const toggleReactionDto = z.object({
  emoji: z.string().trim().min(1, 'Emoji is required').max(32),
});

export const markReadDto = z.object({
  lastReadMessageId: z.string().uuid().optional(),
});

export const presignAttachmentDto = z.object({
  channelId: z.string().uuid('Invalid channel ID'),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(CHAT_ALLOWED_MIME_TYPES),
  sizeBytes: z.number().int().min(1),
});

export const downloadAttachmentQueryDto = z.object({
  channelId: z.string().uuid('Invalid channel ID'),
  key: z.string().min(1).max(512),
  filename: z.string().trim().min(1).max(255).optional(),
  disposition: z.enum(['inline', 'attachment']).default('attachment'),
});

export type ListContactsQuery = z.infer<typeof listContactsQueryDto>;
export type ListChannelsQuery = z.infer<typeof listChannelsQueryDto>;
export type CreateChannelInput = z.infer<typeof createChannelDto>;
export type CreateDirectChannelInput = z.infer<typeof createDirectChannelDto>;
export type UpdateChannelInput = z.infer<typeof updateChannelDto>;
export type AddChannelMembersInput = z.infer<typeof addChannelMembersDto>;
export type UpdateChannelMemberRoleInput = z.infer<typeof updateChannelMemberRoleDto>;
export type UpdateChannelPreferencesInput = z.infer<typeof updateChannelPreferencesDto>;
export type ListMessagesQuery = z.infer<typeof listMessagesQueryDto>;
export type SendMessageInput = z.infer<typeof sendMessageDto>;
export type UpdateMessageInput = z.infer<typeof updateMessageDto>;
export type ToggleReactionInput = z.infer<typeof toggleReactionDto>;
export type MarkReadInput = z.infer<typeof markReadDto>;
export type PresignAttachmentInput = z.infer<typeof presignAttachmentDto>;
export type DownloadAttachmentQuery = z.infer<typeof downloadAttachmentQueryDto>;
