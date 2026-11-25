import { Router, type RequestHandler } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform';
import { requirePermission } from '@/middleware/rbac';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions';

import { createChatController } from './chat.controller';
import * as dto from './chat.dto';
import type { ChatScope } from './chat.types';

interface ScopeGuards {
  read: RequestHandler;
  write: RequestHandler;
}

function buildChatRouter(
  scope: ChatScope,
  authMiddlewares: RequestHandler[],
  guards: ScopeGuards,
): Router {
  const router = Router();
  const ctrl = createChatController(scope);

  router.use(...authMiddlewares);

  // Contacts directory
  router.get(
    '/contacts',
    guards.read,
    validate({ query: dto.listContactsQueryDto }),
    ctrl.listContacts,
  );

  // Attachment presign & download
  router.post(
    '/attachments/presign',
    guards.write,
    validate({ body: dto.presignAttachmentDto }),
    ctrl.presignAttachment,
  );
  router.get(
    '/attachments/download',
    guards.read,
    validate({ query: dto.downloadAttachmentQueryDto }),
    ctrl.downloadAttachment,
  );

  // Channels & DMs
  router.get(
    '/channels',
    guards.read,
    validate({ query: dto.listChannelsQueryDto }),
    ctrl.listChannels,
  );
  router.post(
    '/channels',
    guards.write,
    validate({ body: dto.createChannelDto }),
    ctrl.createChannel,
  );
  router.post(
    '/channels/direct',
    guards.write,
    validate({ body: dto.createDirectChannelDto }),
    ctrl.createDirectChannel,
  );

  router.get(
    '/channels/:channelId',
    guards.read,
    validate({ params: dto.channelIdParamDto }),
    ctrl.getChannel,
  );
  router.patch(
    '/channels/:channelId',
    guards.write,
    validate({ params: dto.channelIdParamDto, body: dto.updateChannelDto }),
    ctrl.updateChannel,
  );
  router.post(
    '/channels/:channelId/join',
    guards.write,
    validate({ params: dto.channelIdParamDto }),
    ctrl.joinChannel,
  );
  router.post(
    '/channels/:channelId/leave',
    guards.write,
    validate({ params: dto.channelIdParamDto }),
    ctrl.leaveChannel,
  );
  router.patch(
    '/channels/:channelId/preferences',
    guards.read,
    validate({ params: dto.channelIdParamDto, body: dto.updateChannelPreferencesDto }),
    ctrl.updatePreferences,
  );
  router.post(
    '/channels/:channelId/read',
    guards.read,
    validate({ params: dto.channelIdParamDto, body: dto.markReadDto }),
    ctrl.markRead,
  );

  // Channel membership
  router.post(
    '/channels/:channelId/members',
    guards.write,
    validate({ params: dto.channelIdParamDto, body: dto.addChannelMembersDto }),
    ctrl.addMembers,
  );
  router.patch(
    '/channels/:channelId/members/:memberId',
    guards.write,
    validate({ params: dto.memberParamDto, body: dto.updateChannelMemberRoleDto }),
    ctrl.updateMemberRole,
  );
  router.delete(
    '/channels/:channelId/members/:memberId',
    guards.write,
    validate({ params: dto.memberParamDto }),
    ctrl.removeMember,
  );

  // Messages, threads, pins, reactions
  router.get(
    '/channels/:channelId/messages',
    guards.read,
    validate({ params: dto.channelIdParamDto, query: dto.listMessagesQueryDto }),
    ctrl.listMessages,
  );
  router.post(
    '/channels/:channelId/messages',
    guards.write,
    validate({ params: dto.channelIdParamDto, body: dto.sendMessageDto }),
    ctrl.sendMessage,
  );
  router.patch(
    '/channels/:channelId/messages/:messageId',
    guards.write,
    validate({ params: dto.messageIdParamDto, body: dto.updateMessageDto }),
    ctrl.editMessage,
  );
  router.delete(
    '/channels/:channelId/messages/:messageId',
    guards.write,
    validate({ params: dto.messageIdParamDto }),
    ctrl.deleteMessage,
  );
  router.post(
    '/channels/:channelId/messages/:messageId/pin',
    guards.write,
    validate({ params: dto.messageIdParamDto }),
    ctrl.togglePinMessage,
  );
  router.post(
    '/channels/:channelId/messages/:messageId/reactions',
    guards.write,
    validate({ params: dto.messageIdParamDto, body: dto.toggleReactionDto }),
    ctrl.toggleReaction,
  );

  return router;
}

export const tenantChatRouter: Router = buildChatRouter('tenant', [requireAuth, requireTenant], {
  read: requirePermission('chat:read'),
  write: requirePermission('chat:write'),
});

export const platformChatRouter: Router = buildChatRouter('platform', [requirePlatformAuth], {
  read: requirePlatformPermission(PLATFORM_PERMISSIONS.CHAT_READ),
  write: requirePlatformPermission(PLATFORM_PERMISSIONS.CHAT_WRITE),
});
