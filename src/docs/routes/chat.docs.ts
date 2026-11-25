import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { bearerAuth, errorResponse, successResponse } from '@/docs/helpers';
import {
  addChannelMembersDto,
  createChannelDto,
  createDirectChannelDto,
  markReadDto,
  presignAttachmentDto,
  sendMessageDto,
  toggleReactionDto,
  updateChannelDto,
  updateChannelPreferencesDto,
  updateMessageDto,
} from '@/modules/chat/chat.dto';

const ChatParticipantSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  roleLabel: z.string().nullable(),
  isOnline: z.boolean(),
});

const ChatChannelSchema = z.object({
  id: z.string().uuid(),
  scope: z.enum(['tenant', 'platform']),
  tenantId: z.string().uuid().nullable(),
  type: z.enum(['DIRECT', 'GROUP', 'PUBLIC', 'PRIVATE']),
  name: z.string().nullable(),
  slug: z.string().nullable(),
  description: z.string().nullable(),
  topic: z.string().nullable(),
  memberCount: z.number(),
  isMember: z.boolean(),
  myRole: z.enum(['OWNER', 'ADMIN', 'MEMBER']).nullable(),
  isMuted: z.boolean(),
  isPinned: z.boolean(),
  unreadCount: z.number(),
  lastMessageAt: z.string().datetime().nullable(),
  lastMessagePreview: z.string().nullable(),
  peer: ChatParticipantSchema.nullable(),
  createdAt: z.string().datetime(),
});

const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  senderId: z.string().uuid(),
  sender: ChatParticipantSchema,
  type: z.enum(['TEXT', 'SYSTEM']),
  body: z.string(),
  parentMessageId: z.string().uuid().nullable(),
  replyCount: z.number(),
  mentions: z.array(z.string().uuid()),
  isPinned: z.boolean(),
  editedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export function registerChatDocs(registry: OpenAPIRegistry): void {
  registry.register('ChatParticipant', ChatParticipantSchema);
  registry.register('ChatChannel', ChatChannelSchema);
  registry.register('ChatMessage', ChatMessageSchema);

  const CreateChannelInput = registry.register('CreateChatChannelInput', createChannelDto);
  const CreateDirectInput = registry.register('CreateDirectChatInput', createDirectChannelDto);
  const UpdateChannelInput = registry.register('UpdateChatChannelInput', updateChannelDto);
  const AddMembersInput = registry.register('AddChatChannelMembersInput', addChannelMembersDto);
  const PreferencesInput = registry.register(
    'UpdateChatPreferencesInput',
    updateChannelPreferencesDto,
  );
  const SendMessageInput = registry.register('SendChatMessageInput', sendMessageDto);
  const UpdateMessageInput = registry.register('UpdateChatMessageInput', updateMessageDto);
  const ToggleReactionInput = registry.register('ToggleChatReactionInput', toggleReactionDto);
  const MarkReadInput = registry.register('MarkChatReadInput', markReadDto);
  const PresignInput = registry.register('PresignChatAttachmentInput', presignAttachmentDto);

  for (const prefix of ['/api/v1/chat', '/api/v1/platform/chat'] as const) {
    const tag = prefix.includes('/platform/') ? 'Platform Chat' : 'Tenant Chat';

    registry.registerPath({
      method: 'get',
      path: `${prefix}/contacts`,
      summary: `List eligible chat participants (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      responses: {
        200: successResponse(z.array(ChatParticipantSchema), 'Contacts retrieved'),
        401: errorResponse('Unauthorized'),
      },
    });

    registry.registerPath({
      method: 'get',
      path: `${prefix}/channels`,
      summary: `List chat channels and direct messages (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      responses: {
        200: successResponse(z.array(ChatChannelSchema), 'Channels retrieved'),
        401: errorResponse('Unauthorized'),
      },
    });

    registry.registerPath({
      method: 'post',
      path: `${prefix}/channels`,
      summary: `Create a chat channel or group (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      request: { body: { content: { 'application/json': { schema: CreateChannelInput } } } },
      responses: {
        201: successResponse(ChatChannelSchema, 'Channel created'),
        400: errorResponse('Invalid channel payload'),
      },
    });

    registry.registerPath({
      method: 'post',
      path: `${prefix}/channels/direct`,
      summary: `Create or fetch a 1:1 direct message channel (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      request: { body: { content: { 'application/json': { schema: CreateDirectInput } } } },
      responses: {
        200: successResponse(ChatChannelSchema, 'Direct channel ready'),
        404: errorResponse('Target participant not found'),
      },
    });

    registry.registerPath({
      method: 'patch',
      path: `${prefix}/channels/{channelId}`,
      summary: `Update channel metadata or archive status (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      request: {
        params: z.object({ channelId: z.string().uuid() }),
        body: { content: { 'application/json': { schema: UpdateChannelInput } } },
      },
      responses: {
        200: successResponse(ChatChannelSchema, 'Channel updated'),
      },
    });

    registry.registerPath({
      method: 'patch',
      path: `${prefix}/channels/{channelId}/preferences`,
      summary: `Update mute or pin preferences (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      request: {
        params: z.object({ channelId: z.string().uuid() }),
        body: { content: { 'application/json': { schema: PreferencesInput } } },
      },
      responses: {
        200: successResponse(ChatChannelSchema, 'Preferences updated'),
      },
    });

    registry.registerPath({
      method: 'post',
      path: `${prefix}/channels/{channelId}/members`,
      summary: `Add members to a channel (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      request: {
        params: z.object({ channelId: z.string().uuid() }),
        body: { content: { 'application/json': { schema: AddMembersInput } } },
      },
      responses: {
        200: successResponse(z.array(z.any()), 'Members added'),
      },
    });

    registry.registerPath({
      method: 'get',
      path: `${prefix}/channels/{channelId}/messages`,
      summary: `List messages in a channel (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      request: { params: z.object({ channelId: z.string().uuid() }) },
      responses: {
        200: successResponse(
          z.object({
            items: z.array(ChatMessageSchema),
            hasMore: z.boolean(),
            nextCursor: z.string().nullable(),
          }),
          'Messages retrieved',
        ),
      },
    });

    registry.registerPath({
      method: 'post',
      path: `${prefix}/channels/{channelId}/messages`,
      summary: `Send a chat message (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      request: {
        params: z.object({ channelId: z.string().uuid() }),
        body: { content: { 'application/json': { schema: SendMessageInput } } },
      },
      responses: {
        201: successResponse(ChatMessageSchema, 'Message sent'),
      },
    });

    registry.registerPath({
      method: 'patch',
      path: `${prefix}/channels/{channelId}/messages/{messageId}`,
      summary: `Edit a chat message (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      request: {
        params: z.object({ channelId: z.string().uuid(), messageId: z.string().uuid() }),
        body: { content: { 'application/json': { schema: UpdateMessageInput } } },
      },
      responses: {
        200: successResponse(ChatMessageSchema, 'Message updated'),
      },
    });

    registry.registerPath({
      method: 'post',
      path: `${prefix}/channels/{channelId}/messages/{messageId}/reactions`,
      summary: `Toggle emoji reaction on a message (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      request: {
        params: z.object({ channelId: z.string().uuid(), messageId: z.string().uuid() }),
        body: { content: { 'application/json': { schema: ToggleReactionInput } } },
      },
      responses: {
        200: successResponse(
          z.object({ added: z.boolean(), reactions: z.array(z.any()) }),
          'Reaction toggled',
        ),
      },
    });

    registry.registerPath({
      method: 'post',
      path: `${prefix}/channels/{channelId}/read`,
      summary: `Mark channel messages as read (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      request: {
        params: z.object({ channelId: z.string().uuid() }),
        body: { content: { 'application/json': { schema: MarkReadInput } } },
      },
      responses: {
        200: successResponse(z.object({ unreadCount: z.number() }), 'Channel marked read'),
      },
    });

    registry.registerPath({
      method: 'post',
      path: `${prefix}/attachments/presign`,
      summary: `Presign an S3 attachment upload (${tag})`,
      tags: [tag],
      security: [{ [bearerAuth.name]: [] }],
      request: { body: { content: { 'application/json': { schema: PresignInput } } } },
      responses: {
        200: successResponse(
          z.object({ uploadUrl: z.string(), key: z.string() }),
          'Upload presigned',
        ),
      },
    });
  }
}
