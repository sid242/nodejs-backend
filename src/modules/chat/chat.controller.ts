import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppError } from '@/lib/errors';
import { AppResponse } from '@/lib/responses';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions';

import type {
  AddChannelMembersInput,
  CreateChannelInput,
  CreateDirectChannelInput,
  DownloadAttachmentQuery,
  ListChannelsQuery,
  ListContactsQuery,
  ListMessagesQuery,
  MarkReadInput,
  PresignAttachmentInput,
  SendMessageInput,
  ToggleReactionInput,
  UpdateChannelInput,
  UpdateChannelMemberRoleInput,
  UpdateChannelPreferencesInput,
  UpdateMessageInput,
} from './chat.dto';
import * as chatService from './chat.service';
import type { ChatContext, ChatScope } from './chat.types';

function resolveChatContext(req: Request, scope: ChatScope): ChatContext {
  if (scope === 'tenant') {
    if (!req.tenant || !req.user?.id) {
      throw AppError.unauthorized('Tenant authentication required');
    }
    const perms = req.permissions ?? [];
    const canManage = perms.includes('*') || perms.includes('chat:manage');
    return {
      scope: 'tenant',
      tenantId: req.tenant.id,
      actorId: req.user.id,
      canManage,
    };
  }

  if (!req.staff?.id) {
    throw AppError.unauthorized('Platform staff authentication required');
  }
  const perms = req.staff.permissions ?? [];
  const canManage =
    req.staff.roleKey === 'SUPER_ADMIN' ||
    perms.includes('*') ||
    perms.includes(PLATFORM_PERMISSIONS.CHAT_MANAGE);
  return {
    scope: 'platform',
    tenantId: null,
    actorId: req.staff.id,
    canManage,
  };
}

export function createChatController(scope: ChatScope) {
  return {
    listContacts: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const query = req.valid!.query as ListContactsQuery;
      const contacts = await chatService.listContacts(ctx, query);
      return AppResponse.ok(contacts).send(res);
    }),

    listChannels: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const query = req.valid!.query as ListChannelsQuery;
      const channels = await chatService.listChannels(ctx, query);
      return AppResponse.ok(channels).send(res);
    }),

    getChannel: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId } = req.valid!.params as { channelId: string };
      const details = await chatService.getChannelDetails(ctx, channelId);
      return AppResponse.ok(details).send(res);
    }),

    createChannel: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const body = req.valid!.body as CreateChannelInput;
      const channel = await chatService.createChannel(ctx, body);
      return AppResponse.created(channel).send(res);
    }),

    createDirectChannel: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const body = req.valid!.body as CreateDirectChannelInput;
      const channel = await chatService.createOrGetDirectChannel(ctx, body);
      return AppResponse.ok(channel).send(res);
    }),

    updateChannel: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId } = req.valid!.params as { channelId: string };
      const body = req.valid!.body as UpdateChannelInput;
      const channel = await chatService.updateChannel(ctx, channelId, body);
      return AppResponse.ok(channel).send(res);
    }),

    joinChannel: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId } = req.valid!.params as { channelId: string };
      const channel = await chatService.joinChannel(ctx, channelId);
      return AppResponse.ok(channel).send(res);
    }),

    leaveChannel: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId } = req.valid!.params as { channelId: string };
      const result = await chatService.leaveChannel(ctx, channelId);
      return AppResponse.ok(result).send(res);
    }),

    addMembers: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId } = req.valid!.params as { channelId: string };
      const body = req.valid!.body as AddChannelMembersInput;
      const members = await chatService.addChannelMembers(ctx, channelId, body);
      return AppResponse.ok(members).send(res);
    }),

    removeMember: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId, memberId } = req.valid!.params as {
        channelId: string;
        memberId: string;
      };
      const result = await chatService.removeChannelMember(ctx, channelId, memberId);
      return AppResponse.ok(result).send(res);
    }),

    updateMemberRole: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId, memberId } = req.valid!.params as {
        channelId: string;
        memberId: string;
      };
      const body = req.valid!.body as UpdateChannelMemberRoleInput;
      const updated = await chatService.updateChannelMemberRole(ctx, channelId, memberId, body);
      return AppResponse.ok(updated).send(res);
    }),

    updatePreferences: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId } = req.valid!.params as { channelId: string };
      const body = req.valid!.body as UpdateChannelPreferencesInput;
      const channel = await chatService.updateChannelPreferences(ctx, channelId, body);
      return AppResponse.ok(channel).send(res);
    }),

    listMessages: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId } = req.valid!.params as { channelId: string };
      const query = req.valid!.query as ListMessagesQuery;
      const result = await chatService.listMessages(ctx, channelId, query);
      return AppResponse.ok(result).send(res);
    }),

    sendMessage: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId } = req.valid!.params as { channelId: string };
      const body = req.valid!.body as SendMessageInput;
      const message = await chatService.sendMessage(ctx, channelId, body);
      return AppResponse.created(message).send(res);
    }),

    editMessage: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId, messageId } = req.valid!.params as {
        channelId: string;
        messageId: string;
      };
      const body = req.valid!.body as UpdateMessageInput;
      const message = await chatService.editMessage(ctx, channelId, messageId, body);
      return AppResponse.ok(message).send(res);
    }),

    deleteMessage: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId, messageId } = req.valid!.params as {
        channelId: string;
        messageId: string;
      };
      const result = await chatService.deleteMessage(ctx, channelId, messageId);
      return AppResponse.ok(result).send(res);
    }),

    togglePinMessage: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId, messageId } = req.valid!.params as {
        channelId: string;
        messageId: string;
      };
      const message = await chatService.togglePinMessage(ctx, channelId, messageId);
      return AppResponse.ok(message).send(res);
    }),

    toggleReaction: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId, messageId } = req.valid!.params as {
        channelId: string;
        messageId: string;
      };
      const body = req.valid!.body as ToggleReactionInput;
      const result = await chatService.toggleReaction(ctx, channelId, messageId, body);
      return AppResponse.ok(result).send(res);
    }),

    markRead: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const { channelId } = req.valid!.params as { channelId: string };
      const body = req.valid!.body as MarkReadInput;
      const result = await chatService.markChannelRead(ctx, channelId, body);
      return AppResponse.ok(result).send(res);
    }),

    presignAttachment: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const body = req.valid!.body as PresignAttachmentInput;
      const result = await chatService.presignAttachmentUpload(ctx, body);
      return AppResponse.ok(result).send(res);
    }),

    downloadAttachment: asyncHandler(async (req: Request, res: Response) => {
      const ctx = resolveChatContext(req, scope);
      const query = req.valid!.query as DownloadAttachmentQuery;
      const result = await chatService.getAttachmentDownloadUrl(ctx, query);
      return AppResponse.ok(result).send(res);
    }),
  };
}
