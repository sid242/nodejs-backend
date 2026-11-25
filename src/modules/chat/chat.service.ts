import { randomUUID } from 'node:crypto';

import { env } from '@/config/env';
import { AppError } from '@/lib/errors';
import { getClientHost } from '@/lib/request-context';
import { createDownloadUrl, createUploadPost } from '@/lib/s3';
import { generateSlug, safeFilename } from '@/lib/utils';
import { notify } from '@/modules/notifications/notifications.service';
import { emitToChatActor, emitToChatChannel, emitToChatScope } from '@/sockets/emitter';

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
import * as chatRepo from './chat.repository';
import type {
  ChatChannelView,
  ChatContext,
  ChatMemberView,
  ChatMessageParentPreview,
  ChatMessageView,
  ChatPaginatedMessages,
  ChatParticipantProfile,
} from './chat.types';

function scopeKey(ctx: ChatContext): string {
  return ctx.scope === 'tenant' ? ctx.tenantId : 'platform';
}

function makeDirectKey(actorA: string, actorB: string): string {
  return [actorA, actorB].sort().join(':');
}

function makePreviewText(body: string, attachmentCount: number): string {
  const trimmed = body.trim().replace(/\s+/g, ' ');
  if (trimmed) {
    return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
  }
  return attachmentCount === 1 ? 'Sent an attachment' : `Sent ${attachmentCount} attachments`;
}

function fallbackProfile(id: string): ChatParticipantProfile {
  return {
    id,
    displayName: 'Former Member',
    email: '',
    avatarUrl: null,
    roleLabel: null,
    isOnline: false,
  };
}

async function requireChannelAndAccess(
  ctx: ChatContext,
  channelId: string,
  options: { requireMembership?: boolean; allowArchived?: boolean } = {},
) {
  const channel = await chatRepo.findChannelById(ctx, channelId);
  if (!channel) throw AppError.notFound('Chat channel not found');
  if (options.allowArchived === false && channel.isArchived) {
    throw AppError.badRequest('This channel is archived');
  }

  const membership = await chatRepo.findMember(ctx, channelId, ctx.actorId);
  const canReadPublic = channel.type === 'PUBLIC' && !options.requireMembership;
  if (!membership && !canReadPublic) {
    throw AppError.forbidden('You do not have access to this chat channel');
  }

  return { channel, membership };
}

function assertChannelAdmin(ctx: ChatContext, membership: chatRepo.RawMember | null): void {
  const isChannelAdmin = membership?.role === 'OWNER' || membership?.role === 'ADMIN';
  if (!isChannelAdmin && !ctx.canManage) {
    throw AppError.forbidden('Channel owner, admin, or chat management permission is required');
  }
}

async function buildChannelViews(
  ctx: ChatContext,
  channels: chatRepo.RawChannel[],
  myMemberships: Map<string, chatRepo.RawMember>,
  memberCounts: Map<string, number>,
  directMembersMap: Map<string, string[]>,
): Promise<ChatChannelView[]> {
  const peerIds: string[] = [];
  for (const ch of channels) {
    if (ch.type === 'DIRECT') {
      const members = directMembersMap.get(ch.id) ?? [];
      const peerId = members.find((id) => id !== ctx.actorId) ?? ctx.actorId;
      peerIds.push(peerId);
    }
  }

  const profiles = await chatRepo.hydrateProfiles(ctx.scope, ctx.tenantId, peerIds);

  const views = channels.map((ch): ChatChannelView => {
    const myMember = myMemberships.get(ch.id) ?? null;
    let peer: ChatParticipantProfile | null = null;
    if (ch.type === 'DIRECT') {
      const members = directMembersMap.get(ch.id) ?? [];
      const peerId = members.find((id) => id !== ctx.actorId) ?? ctx.actorId;
      peer = profiles.get(peerId) ?? fallbackProfile(peerId);
    }

    return {
      id: ch.id,
      scope: ctx.scope,
      tenantId: ch.tenantId,
      type: ch.type,
      name: ch.type === 'DIRECT' && peer ? peer.displayName : ch.name,
      slug: ch.slug,
      description: ch.description,
      topic: ch.topic,
      directKey: ch.directKey,
      createdByActorId: ch.createdByActorId,
      isArchived: ch.isArchived,
      archivedAt: ch.archivedAt,
      lastMessageAt: ch.lastMessageAt,
      lastMessagePreview: ch.lastMessagePreview,
      lastMessageSenderId: ch.lastMessageSenderId,
      messageCount: ch.messageCount,
      memberCount: memberCounts.get(ch.id) ?? 0,
      isMember: Boolean(myMember),
      myRole: myMember?.role ?? null,
      isMuted: myMember?.isMuted ?? false,
      isPinned: myMember?.isPinned ?? false,
      unreadCount: myMember?.unreadCount ?? 0,
      lastReadMessageId: myMember?.lastReadMessageId ?? null,
      peer,
      createdAt: ch.createdAt,
      updatedAt: ch.updatedAt,
    };
  });

  // Sort: pinned first, then latest activity, then creation time
  views.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    const aTime = (a.lastMessageAt ?? a.createdAt).getTime();
    const bTime = (b.lastMessageAt ?? b.createdAt).getTime();
    return bTime - aTime;
  });

  return views;
}

async function buildSingleChannelView(
  ctx: ChatContext,
  channel: chatRepo.RawChannel,
): Promise<ChatChannelView> {
  const members = await chatRepo.listChannelMembers(ctx, channel.id);
  const myMembership = members.find((m) => m.actorId === ctx.actorId);
  const myMap = new Map<string, chatRepo.RawMember>();
  if (myMembership) myMap.set(channel.id, myMembership);

  const countMap = new Map<string, number>([[channel.id, members.length]]);
  const directMap = new Map<string, string[]>();
  if (channel.type === 'DIRECT') {
    directMap.set(
      channel.id,
      members.map((m) => m.actorId),
    );
  }

  const [view] = await buildChannelViews(ctx, [channel], myMap, countMap, directMap);
  return view!;
}

async function buildMessageViews(
  ctx: ChatContext,
  channelId: string,
  messages: chatRepo.RawMessage[],
): Promise<ChatMessageView[]> {
  if (messages.length === 0) return [];

  const messageIds = messages.map((m) => m.id);
  const parentIds = messages
    .map((m) => m.parentMessageId)
    .filter((id): id is string => Boolean(id));

  const [reactions, parentRows, attachmentsByMessage, mentionsByMessage] = await Promise.all([
    chatRepo.listReactionsForMessages(ctx, channelId, messageIds),
    chatRepo.findMessagesByIds(ctx, channelId, parentIds),
    chatRepo.listAttachmentsForMessages(ctx, channelId, messageIds),
    chatRepo.listMentionsForMessages(ctx, channelId, messageIds),
  ]);

  const actorIds = [...messages.map((m) => m.senderId), ...parentRows.map((p) => p.senderId)];
  const profiles = await chatRepo.hydrateProfiles(ctx.scope, ctx.tenantId, actorIds);
  const reactionsByMessage = chatRepo.groupReactions(reactions, ctx.actorId);
  const parentMap = new Map(parentRows.map((p) => [p.id, p]));

  return messages.map((m): ChatMessageView => {
    const sender = profiles.get(m.senderId) ?? fallbackProfile(m.senderId);
    let parentMessage: ChatMessageParentPreview | null = null;
    if (m.parentMessageId) {
      const parent = parentMap.get(m.parentMessageId);
      if (parent) {
        const parentSender = profiles.get(parent.senderId) ?? fallbackProfile(parent.senderId);
        parentMessage = {
          id: parent.id,
          senderId: parent.senderId,
          senderName: parentSender.displayName,
          body: parent.deletedAt ? 'Message deleted' : parent.body,
          deletedAt: parent.deletedAt,
        };
      }
    }

    const isDeleted = Boolean(m.deletedAt);
    return {
      id: m.id,
      channelId: m.channelId,
      senderId: m.senderId,
      sender,
      type: m.type,
      body: isDeleted ? '' : m.body,
      parentMessageId: m.parentMessageId,
      parentMessage,
      replyCount: m.replyCount,
      mentions: isDeleted ? [] : (mentionsByMessage.get(m.id) ?? []),
      attachments: isDeleted ? [] : (attachmentsByMessage.get(m.id) ?? []),
      reactions: isDeleted ? [] : (reactionsByMessage.get(m.id) ?? []),
      isPinned: isDeleted ? false : m.isPinned,
      pinnedByActorId: isDeleted ? null : m.pinnedByActorId,
      pinnedAt: isDeleted ? null : m.pinnedAt,
      editedAt: m.editedAt,
      deletedAt: m.deletedAt,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  });
}

async function emitChannelStateToMembers(
  ctx: ChatContext,
  channel: chatRepo.RawChannel,
  event: string,
): Promise<void> {
  const sKey = scopeKey(ctx);
  if (channel.type === 'PUBLIC') {
    emitToChatScope(ctx.scope, sKey, event, { channelId: channel.id, scope: ctx.scope });
    return;
  }
  const members = await chatRepo.listChannelMembers(ctx, channel.id);
  for (const m of members) {
    emitToChatActor(ctx.scope, sKey, m.actorId, event, {
      channelId: channel.id,
      scope: ctx.scope,
    });
  }
}

// =============================================================================
// Public Service Operations
// =============================================================================

export async function listContacts(ctx: ChatContext, query: ListContactsQuery) {
  return chatRepo.listActiveContacts(ctx, query.q);
}

export async function listChannels(ctx: ChatContext, query: ListChannelsQuery) {
  const { channels, myMemberships, memberCounts, directMembersMap } =
    await chatRepo.listVisibleChannels(ctx, {
      includeArchived: query.includeArchived,
      type: query.type,
      q: query.q,
    });
  return buildChannelViews(ctx, channels, myMemberships, memberCounts, directMembersMap);
}

export async function getChannelDetails(
  ctx: ChatContext,
  channelId: string,
): Promise<{ channel: ChatChannelView; members: ChatMemberView[] }> {
  const { channel } = await requireChannelAndAccess(ctx, channelId);
  const rawMembers = await chatRepo.listChannelMembers(ctx, channelId);
  const profiles = await chatRepo.hydrateProfiles(
    ctx.scope,
    ctx.tenantId,
    rawMembers.map((m) => m.actorId),
  );

  const members: ChatMemberView[] = rawMembers.map((m) => ({
    id: m.id,
    channelId: m.channelId,
    actorId: m.actorId,
    role: m.role,
    isMuted: m.isMuted,
    isPinned: m.isPinned,
    lastReadAt: m.lastReadAt,
    lastReadMessageId: m.lastReadMessageId,
    unreadCount: m.unreadCount,
    joinedAt: m.joinedAt,
    profile: profiles.get(m.actorId) ?? fallbackProfile(m.actorId),
  }));

  const view = await buildSingleChannelView(ctx, channel);
  return { channel: view, members };
}

export async function createChannel(
  ctx: ChatContext,
  input: CreateChannelInput,
): Promise<ChatChannelView> {
  const uniqueOtherIds = Array.from(new Set(input.memberIds)).filter((id) => id !== ctx.actorId);
  const validOthers = await chatRepo.verifyActiveActors(ctx, uniqueOtherIds);
  if (validOthers.length !== uniqueOtherIds.length) {
    throw AppError.badRequest('One or more selected members are not active in this scope');
  }

  let slug: string | null = null;
  if (input.type === 'PUBLIC' || input.type === 'PRIVATE') {
    const baseSlug = generateSlug(input.name) || 'channel';
    const existing = await chatRepo.findChannelBySlug(ctx, baseSlug);
    slug = existing ? `${baseSlug}-${randomUUID().slice(0, 6)}` : baseSlug;
  }

  const members: Array<{ actorId: string; role: 'OWNER' | 'MEMBER' }> = [
    { actorId: ctx.actorId, role: 'OWNER' },
    ...validOthers.map((actorId) => ({ actorId, role: 'MEMBER' as const })),
  ];

  const created = await chatRepo.createChannelWithMembers(
    ctx,
    {
      type: input.type,
      name: input.name,
      slug,
      description: input.description ?? null,
      topic: input.topic ?? null,
      directKey: null,
    },
    members,
  );

  await emitChannelStateToMembers(ctx, created, 'chat:channel:updated');
  return buildSingleChannelView(ctx, created);
}

export async function createOrGetDirectChannel(
  ctx: ChatContext,
  input: CreateDirectChannelInput,
): Promise<ChatChannelView> {
  const validTargets = await chatRepo.verifyActiveActors(ctx, [input.targetActorId]);
  if (validTargets.length === 0) {
    throw AppError.notFound('Selected colleague was not found or is not active');
  }

  const directKey = makeDirectKey(ctx.actorId, input.targetActorId);
  const existing = await chatRepo.findDirectChannelByKey(ctx, directKey);
  if (existing) {
    // Ensure requester membership exists if somehow removed
    const myMembership = await chatRepo.findMember(ctx, existing.id, ctx.actorId);
    if (!myMembership) {
      await chatRepo.addMembers(ctx, existing.id, [{ actorId: ctx.actorId, role: 'MEMBER' }]);
    }
    return buildSingleChannelView(ctx, existing);
  }

  const memberIds =
    input.targetActorId === ctx.actorId
      ? [{ actorId: ctx.actorId, role: 'OWNER' as const }]
      : [
          { actorId: ctx.actorId, role: 'OWNER' as const },
          { actorId: input.targetActorId, role: 'OWNER' as const },
        ];

  const created = await chatRepo.createChannelWithMembers(
    ctx,
    {
      type: 'DIRECT',
      name: null,
      slug: null,
      description: null,
      topic: null,
      directKey,
    },
    memberIds,
  );

  await emitChannelStateToMembers(ctx, created, 'chat:channel:updated');
  return buildSingleChannelView(ctx, created);
}

export async function updateChannel(
  ctx: ChatContext,
  channelId: string,
  input: UpdateChannelInput,
): Promise<ChatChannelView> {
  const { channel, membership } = await requireChannelAndAccess(ctx, channelId);
  if (channel.type === 'DIRECT') {
    throw AppError.badRequest('Direct message channels cannot be renamed or archived');
  }
  assertChannelAdmin(ctx, membership);

  const updated = await chatRepo.updateChannel(ctx, channelId, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.topic !== undefined ? { topic: input.topic } : {}),
    ...(input.isArchived !== undefined
      ? { isArchived: input.isArchived, archivedAt: input.isArchived ? new Date() : null }
      : {}),
  });
  if (!updated) throw AppError.notFound('Chat channel not found');

  await emitChannelStateToMembers(ctx, updated, 'chat:channel:updated');
  emitToChatChannel(ctx.scope, scopeKey(ctx), channelId, 'chat:channel:updated', {
    channelId,
    scope: ctx.scope,
  });
  return buildSingleChannelView(ctx, updated);
}

export async function joinChannel(ctx: ChatContext, channelId: string): Promise<ChatChannelView> {
  const channel = await chatRepo.findChannelById(ctx, channelId);
  if (!channel) throw AppError.notFound('Chat channel not found');
  if (channel.type !== 'PUBLIC') {
    throw AppError.forbidden('Only public channels can be joined directly');
  }
  if (channel.isArchived) {
    throw AppError.badRequest('Cannot join an archived channel');
  }

  await chatRepo.addMembers(ctx, channelId, [{ actorId: ctx.actorId, role: 'MEMBER' }]);
  emitToChatChannel(ctx.scope, scopeKey(ctx), channelId, 'chat:channel:updated', {
    channelId,
    scope: ctx.scope,
  });
  return buildSingleChannelView(ctx, channel);
}

export async function leaveChannel(ctx: ChatContext, channelId: string): Promise<{ left: true }> {
  const { channel, membership } = await requireChannelAndAccess(ctx, channelId, {
    requireMembership: true,
  });
  if (channel.type === 'DIRECT') {
    throw AppError.badRequest('Cannot leave a 1:1 direct message conversation');
  }

  const allMembers = await chatRepo.listChannelMembers(ctx, channelId);
  if (membership?.role === 'OWNER') {
    const otherOwners = allMembers.filter((m) => m.actorId !== ctx.actorId && m.role === 'OWNER');
    if (otherOwners.length === 0) {
      const candidate =
        allMembers.find((m) => m.actorId !== ctx.actorId && m.role === 'ADMIN') ??
        allMembers.find((m) => m.actorId !== ctx.actorId);
      if (candidate) {
        await chatRepo.updateMemberRole(ctx, channelId, candidate.actorId, 'OWNER');
      }
    }
  }

  await chatRepo.removeMember(ctx, channelId, ctx.actorId);
  emitToChatChannel(ctx.scope, scopeKey(ctx), channelId, 'chat:channel:updated', {
    channelId,
    scope: ctx.scope,
  });
  return { left: true };
}

export async function addChannelMembers(
  ctx: ChatContext,
  channelId: string,
  input: AddChannelMembersInput,
): Promise<ChatMemberView[]> {
  const { channel, membership } = await requireChannelAndAccess(ctx, channelId, {
    requireMembership: true,
    allowArchived: false,
  });
  if (channel.type === 'DIRECT') {
    throw AppError.badRequest('Cannot add members to a 1:1 direct message');
  }
  if (channel.type === 'PRIVATE') {
    assertChannelAdmin(ctx, membership);
  }

  const validActors = await chatRepo.verifyActiveActors(ctx, input.memberIds);
  if (validActors.length !== input.memberIds.length) {
    throw AppError.badRequest('One or more selected members are not active');
  }

  await chatRepo.addMembers(
    ctx,
    channelId,
    validActors.map((actorId) => ({ actorId, role: 'MEMBER' as const })),
  );

  for (const actorId of validActors) {
    emitToChatActor(ctx.scope, scopeKey(ctx), actorId, 'chat:channel:updated', {
      channelId,
      scope: ctx.scope,
    });
  }
  emitToChatChannel(ctx.scope, scopeKey(ctx), channelId, 'chat:channel:updated', {
    channelId,
    scope: ctx.scope,
  });

  const details = await getChannelDetails(ctx, channelId);
  return details.members;
}

export async function removeChannelMember(
  ctx: ChatContext,
  channelId: string,
  targetActorId: string,
): Promise<{ removed: true }> {
  const { channel, membership } = await requireChannelAndAccess(ctx, channelId, {
    requireMembership: true,
  });
  if (channel.type === 'DIRECT') {
    throw AppError.badRequest('Cannot remove participants from a direct message');
  }
  if (targetActorId !== ctx.actorId) {
    assertChannelAdmin(ctx, membership);
  }

  const target = await chatRepo.findMember(ctx, channelId, targetActorId);
  if (!target) throw AppError.notFound('Channel member not found');
  if (target.role === 'OWNER' && targetActorId !== ctx.actorId && !ctx.canManage) {
    throw AppError.forbidden('Cannot remove a channel owner');
  }

  await chatRepo.removeMember(ctx, channelId, targetActorId);
  emitToChatActor(ctx.scope, scopeKey(ctx), targetActorId, 'chat:channel:updated', {
    channelId,
    scope: ctx.scope,
    removed: true,
  });
  emitToChatChannel(ctx.scope, scopeKey(ctx), channelId, 'chat:channel:updated', {
    channelId,
    scope: ctx.scope,
  });
  return { removed: true };
}

export async function updateChannelMemberRole(
  ctx: ChatContext,
  channelId: string,
  targetActorId: string,
  input: UpdateChannelMemberRoleInput,
) {
  const { channel, membership } = await requireChannelAndAccess(ctx, channelId, {
    requireMembership: true,
  });
  if (channel.type === 'DIRECT') {
    throw AppError.badRequest('Direct message channels do not have admin roles');
  }
  assertChannelAdmin(ctx, membership);

  const updated = await chatRepo.updateMemberRole(ctx, channelId, targetActorId, input.role);
  if (!updated) throw AppError.notFound('Channel member not found');
  emitToChatChannel(ctx.scope, scopeKey(ctx), channelId, 'chat:channel:updated', {
    channelId,
    scope: ctx.scope,
  });
  return updated;
}

export async function updateChannelPreferences(
  ctx: ChatContext,
  channelId: string,
  input: UpdateChannelPreferencesInput,
): Promise<ChatChannelView> {
  await requireChannelAndAccess(ctx, channelId, { requireMembership: true });
  const updated = await chatRepo.updateMemberPreferences(ctx, channelId, ctx.actorId, input);
  if (!updated) throw AppError.notFound('Channel membership not found');
  const channel = await chatRepo.findChannelById(ctx, channelId);
  return buildSingleChannelView(ctx, channel!);
}

export async function listMessages(
  ctx: ChatContext,
  channelId: string,
  query: ListMessagesQuery,
): Promise<ChatPaginatedMessages> {
  await requireChannelAndAccess(ctx, channelId);

  const { messages, hasMore } = await chatRepo.listMessages(ctx, channelId, {
    before: query.before,
    after: query.after,
    parentMessageId: query.parentMessageId,
    q: query.q,
    pinnedOnly: query.pinnedOnly,
    limit: query.limit,
  });

  const items = await buildMessageViews(ctx, channelId, messages);
  const nextCursor = hasMore && items.length > 0 ? (items[0]?.id ?? null) : null;

  return { items, hasMore, nextCursor };
}

export async function sendMessage(
  ctx: ChatContext,
  channelId: string,
  input: SendMessageInput,
): Promise<ChatMessageView> {
  const { channel } = await requireChannelAndAccess(ctx, channelId, {
    requireMembership: true,
    allowArchived: false,
  });

  if (input.parentMessageId) {
    const parent = await chatRepo.findMessageById(ctx, channelId, input.parentMessageId);
    if (!parent) {
      throw AppError.badRequest('Parent message does not exist in this channel');
    }
  }

  const sKey = scopeKey(ctx);
  for (const att of input.attachments) {
    const expectedPrefix = `chat/${sKey}/${channelId}/`;
    if (!att.key.startsWith(expectedPrefix)) {
      throw AppError.forbidden('Attachment key does not belong to this channel');
    }
  }

  const uniqueMentions = Array.from(new Set(input.mentions));
  const activeActors =
    uniqueMentions.length > 0 ? await chatRepo.verifyActiveActors(ctx, uniqueMentions) : [];
  const validMentions =
    activeActors.length > 0
      ? await chatRepo.filterActiveChannelMembers(ctx, channelId, activeActors)
      : [];

  const body = input.body.trim();
  const previewText = makePreviewText(body, input.attachments.length);

  const created = await chatRepo.createMessage(ctx, {
    channelId,
    type: 'TEXT',
    body,
    parentMessageId: input.parentMessageId ?? null,
    mentions: validMentions,
    attachments: input.attachments,
    previewText,
  });

  const [view] = await buildMessageViews(ctx, channelId, [created]);
  const messageView = view!;

  emitToChatChannel(ctx.scope, sKey, channelId, 'chat:message:created', {
    scope: ctx.scope,
    channelId,
    message: messageView,
  });

  const members = await chatRepo.listChannelMembers(ctx, channelId);
  for (const m of members) {
    emitToChatActor(ctx.scope, sKey, m.actorId, 'chat:channel:updated', {
      scope: ctx.scope,
      channelId,
      lastMessageAt: created.createdAt.toISOString(),
      lastMessagePreview: previewText,
      lastMessageSenderId: ctx.actorId,
    });
  }

  if (ctx.scope === 'tenant') {
    const notifyMentionIds = validMentions.filter((id) => id !== ctx.actorId);
    if (notifyMentionIds.length > 0) {
      const channelLabel =
        channel.type === 'DIRECT' ? 'a direct message' : `#${channel.name ?? 'channel'}`;
      void notify({
        recipients: notifyMentionIds,
        type: 'chat.mention',
        title: `${messageView.sender.displayName} mentioned you in ${channelLabel}`,
        body: previewText,
        link: `/chat?channel=${channelId}`,
        tenantId: ctx.tenantId,
        actorUserId: ctx.actorId,
        data: { channelId, messageId: created.id },
      }).catch(() => {});
    } else if (channel.type === 'DIRECT') {
      const recipients = members
        .filter((m) => m.actorId !== ctx.actorId && !m.isMuted)
        .map((m) => m.actorId);
      if (recipients.length > 0) {
        void notify({
          recipients,
          type: 'chat.direct_message',
          title: `New message from ${messageView.sender.displayName}`,
          body: previewText,
          link: `/chat?channel=${channelId}`,
          tenantId: ctx.tenantId,
          actorUserId: ctx.actorId,
          data: { channelId, messageId: created.id },
        }).catch(() => {});
      }
    }
  }

  return messageView;
}

export async function editMessage(
  ctx: ChatContext,
  channelId: string,
  messageId: string,
  input: UpdateMessageInput,
): Promise<ChatMessageView> {
  await requireChannelAndAccess(ctx, channelId, {
    requireMembership: true,
    allowArchived: false,
  });
  const existing = await chatRepo.findMessageById(ctx, channelId, messageId);
  if (!existing || existing.deletedAt) throw AppError.notFound('Message not found');
  if (existing.senderId !== ctx.actorId) {
    throw AppError.forbidden('You can only edit your own messages');
  }

  let mentions: string[] | undefined;
  if (input.mentions) {
    const activeActors = await chatRepo.verifyActiveActors(
      ctx,
      Array.from(new Set(input.mentions)),
    );
    mentions =
      activeActors.length > 0
        ? await chatRepo.filterActiveChannelMembers(ctx, channelId, activeActors)
        : [];
  }

  const updated = await chatRepo.updateMessageBody(ctx, channelId, messageId, input.body, mentions);
  if (!updated) throw AppError.notFound('Message not found');

  const [view] = await buildMessageViews(ctx, channelId, [updated]);
  emitToChatChannel(ctx.scope, scopeKey(ctx), channelId, 'chat:message:updated', {
    scope: ctx.scope,
    channelId,
    message: view!,
  });
  return view!;
}

export async function deleteMessage(
  ctx: ChatContext,
  channelId: string,
  messageId: string,
): Promise<{ id: string; deletedAt: Date }> {
  const { membership } = await requireChannelAndAccess(ctx, channelId, {
    requireMembership: true,
    allowArchived: false,
  });
  const existing = await chatRepo.findMessageById(ctx, channelId, messageId);
  if (!existing || existing.deletedAt) throw AppError.notFound('Message not found');

  const isAuthor = existing.senderId === ctx.actorId;
  if (!isAuthor) {
    assertChannelAdmin(ctx, membership);
  }

  const deleted = await chatRepo.softDeleteMessage(ctx, channelId, messageId);
  if (!deleted) throw AppError.notFound('Message not found');

  emitToChatChannel(ctx.scope, scopeKey(ctx), channelId, 'chat:message:deleted', {
    scope: ctx.scope,
    channelId,
    messageId,
    deletedAt: deleted.deletedAt!.toISOString(),
  });
  return { id: deleted.id, deletedAt: deleted.deletedAt! };
}

export async function togglePinMessage(
  ctx: ChatContext,
  channelId: string,
  messageId: string,
): Promise<ChatMessageView> {
  const { membership } = await requireChannelAndAccess(ctx, channelId, {
    requireMembership: true,
    allowArchived: false,
  });
  assertChannelAdmin(ctx, membership);

  const existing = await chatRepo.findMessageById(ctx, channelId, messageId);
  if (!existing || existing.deletedAt) throw AppError.notFound('Message not found');

  const updated = await chatRepo.setMessagePin(ctx, channelId, messageId, !existing.isPinned);
  if (!updated) throw AppError.notFound('Message not found');

  const [view] = await buildMessageViews(ctx, channelId, [updated]);
  emitToChatChannel(ctx.scope, scopeKey(ctx), channelId, 'chat:message:updated', {
    scope: ctx.scope,
    channelId,
    message: view!,
  });
  return view!;
}

export async function toggleReaction(
  ctx: ChatContext,
  channelId: string,
  messageId: string,
  input: ToggleReactionInput,
) {
  await requireChannelAndAccess(ctx, channelId, {
    requireMembership: true,
    allowArchived: false,
  });
  const existing = await chatRepo.findMessageById(ctx, channelId, messageId);
  if (!existing || existing.deletedAt) throw AppError.notFound('Message not found');

  const { added, reactions } = await chatRepo.toggleReaction(
    ctx,
    channelId,
    messageId,
    input.emoji,
  );
  const grouped = chatRepo.groupReactions(reactions, ctx.actorId).get(messageId) ?? [];

  emitToChatChannel(ctx.scope, scopeKey(ctx), channelId, 'chat:reaction:updated', {
    scope: ctx.scope,
    channelId,
    messageId,
    reactions: grouped,
  });

  return { added, reactions: grouped };
}

export async function markChannelRead(ctx: ChatContext, channelId: string, input: MarkReadInput) {
  await requireChannelAndAccess(ctx, channelId, { requireMembership: true });

  let cursorAt: Date | undefined;
  if (input.lastReadMessageId) {
    const cursorMsg = await chatRepo.findMessageById(ctx, channelId, input.lastReadMessageId);
    if (!cursorMsg) {
      throw AppError.badRequest('Read cursor message does not belong to this channel');
    }
    cursorAt = cursorMsg.createdAt;
  }

  const updated = await chatRepo.markChannelRead(ctx, channelId, input.lastReadMessageId, cursorAt);
  if (!updated) throw AppError.notFound('Channel membership not found');

  const readPayload = {
    scope: ctx.scope,
    channelId,
    actorId: ctx.actorId,
    lastReadMessageId: updated.lastReadMessageId,
    lastReadAt: updated.lastReadAt?.toISOString() ?? null,
  };
  emitToChatActor(ctx.scope, scopeKey(ctx), ctx.actorId, 'chat:read', readPayload);
  emitToChatChannel(ctx.scope, scopeKey(ctx), channelId, 'chat:read', readPayload);

  return {
    channelId,
    unreadCount: updated.unreadCount,
    lastReadAt: updated.lastReadAt,
    lastReadMessageId: updated.lastReadMessageId,
  };
}

export async function presignAttachmentUpload(ctx: ChatContext, input: PresignAttachmentInput) {
  await requireChannelAndAccess(ctx, input.channelId, {
    requireMembership: true,
    allowArchived: false,
  });

  const maxBytes = env.S3_MAX_UPLOAD_MB * 1024 * 1024;
  if (input.sizeBytes > maxBytes) {
    throw AppError.badRequest(`File exceeds maximum allowed size of ${env.S3_MAX_UPLOAD_MB}MB`);
  }

  const fileId = randomUUID();
  const cleanName = safeFilename(input.filename);
  const key = `chat/${scopeKey(ctx)}/${input.channelId}/${fileId}/${cleanName}`;
  const post = await createUploadPost({
    key,
    contentType: input.mimeType,
    clientHost: getClientHost(),
  });

  return {
    id: fileId,
    key,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    uploadUrl: post.url,
    fields: post.fields,
  };
}

export async function getAttachmentDownloadUrl(ctx: ChatContext, query: DownloadAttachmentQuery) {
  await requireChannelAndAccess(ctx, query.channelId);

  const expectedPrefix = `chat/${scopeKey(ctx)}/${query.channelId}/`;
  if (!query.key.startsWith(expectedPrefix)) {
    throw AppError.forbidden('Attachment key does not belong to this channel');
  }

  if (await chatRepo.isAttachmentMessageDeleted(ctx, query.channelId, query.key)) {
    throw AppError.notFound('Attachment is no longer available');
  }

  const downloadUrl = await createDownloadUrl(query.key, 300, {
    filename: query.filename,
    disposition: query.disposition,
    clientHost: getClientHost(),
  });

  return { downloadUrl };
}
