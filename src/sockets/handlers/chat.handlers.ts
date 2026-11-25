import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

import { runWithTenantDb } from '@/db/tenancy/context';
import { withTenantTransaction } from '@/db/tenancy/rls';
import { getTenantDb } from '@/db/tenancy/tenant-db';
import * as chatRepo from '@/modules/chat/chat.repository';

import { getSocketAuthState } from '../types';

const chatChannelJoinSchema = z.object({ channelId: z.string().uuid() });
const chatTypingSchema = z.object({
  channelId: z.string().uuid(),
  isTyping: z.boolean(),
});

function resolveChatScope(socket: Socket): {
  scope: 'tenant' | 'platform';
  scopeId: string;
} | null {
  const { actorType, workspaceTenantId, isSupportSession } = getSocketAuthState(socket);
  if (actorType === 'STAFF') {
    return { scope: 'platform', scopeId: 'platform' };
  }
  if (actorType === 'USER' && workspaceTenantId && !isSupportSession) {
    return { scope: 'tenant', scopeId: workspaceTenantId };
  }
  return null;
}

export function joinChatPresenceRooms(io: Server, socket: Socket): void {
  const { actorType, user, workspaceTenantId, isSupportSession } = getSocketAuthState(socket);
  const userId = user?.id;
  if (!userId) return;

  if (actorType === 'STAFF') {
    void socket.join(`staff:${userId}`);
    void socket.join('platform:chat');
    void chatRepo.setActorPresence('platform', 'platform', userId, true).then(() => {
      io.to('platform:chat').emit('chat:presence', {
        scope: 'platform',
        actorId: userId,
        online: true,
      });
    });
    return;
  }

  if (!isSupportSession) {
    void socket.join(`user:${userId}`);
    if (workspaceTenantId) {
      void socket.join(`workspace-user:${workspaceTenantId}:${userId}`);
      void socket.join(`tenant-chat:${workspaceTenantId}`);
      void chatRepo.setActorPresence('tenant', workspaceTenantId, userId, true).then(() => {
        io.to(`tenant-chat:${workspaceTenantId}`).emit('chat:presence', {
          scope: 'tenant',
          actorId: userId,
          online: true,
        });
      });
    }
  }
}

export async function refreshChatPresence(socket: Socket): Promise<void> {
  const state = getSocketAuthState(socket);
  const scopeInfo = resolveChatScope(socket);
  if (!scopeInfo || !state.user?.id) return;
  await chatRepo.setActorPresence(scopeInfo.scope, scopeInfo.scopeId, state.user.id, true);
}

async function authorizeChatChannel(
  socket: Socket,
  channelId: string,
): Promise<{ scope: 'tenant' | 'platform'; scopeId: string; room: string } | null> {
  const { actorType, user, workspaceTenantId, workspaceTenant } = getSocketAuthState(socket);
  const userId = user?.id;
  if (!userId) return null;

  if (actorType === 'STAFF') {
    const ctx = {
      scope: 'platform' as const,
      tenantId: null,
      actorId: userId,
      canManage: false,
    };
    const [channel, membership] = await Promise.all([
      chatRepo.findChannelById(ctx, channelId),
      chatRepo.findMember(ctx, channelId, userId),
    ]);
    if (!channel || (!membership && channel.type !== 'PUBLIC')) return null;
    return {
      scope: 'platform',
      scopeId: 'platform',
      room: `chat:platform:platform:${channelId}`,
    };
  }

  if (actorType === 'USER' && workspaceTenantId) {
    const dbHandle = await getTenantDb(workspaceTenant ?? workspaceTenantId);
    const ctx = {
      scope: 'tenant' as const,
      tenantId: workspaceTenantId,
      actorId: userId,
      canManage: false,
    };
    const checkMembership = () =>
      Promise.all([
        chatRepo.findChannelById(ctx, channelId),
        chatRepo.findMember(ctx, channelId, userId),
      ]);

    const [channel, membership] =
      workspaceTenant?.databaseMode === 'dedicated'
        ? await runWithTenantDb(
            { tenantId: workspaceTenantId, db: dbHandle, databaseMode: 'dedicated' },
            checkMembership,
          )
        : await withTenantTransaction(workspaceTenantId, checkMembership, dbHandle);

    if (!channel || (!membership && channel.type !== 'PUBLIC')) return null;
    return {
      scope: 'tenant',
      scopeId: workspaceTenantId,
      room: `chat:tenant:${workspaceTenantId}:${channelId}`,
    };
  }

  return null;
}

export function registerChatHandlers(socket: Socket): void {
  const { user, isSupportSession } = getSocketAuthState(socket);

  socket.on('chat:join', async (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const { channelId } = chatChannelJoinSchema.parse(payload);
      const auth = await authorizeChatChannel(socket, channelId);
      if (!auth) {
        ack?.({ ok: false, error: 'forbidden' });
        return;
      }
      await socket.join(auth.room);
      ack?.({ ok: true, room: auth.room });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'invalid_payload' });
    }
  });

  socket.on('chat:leave', async (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const { channelId } = chatChannelJoinSchema.parse(payload);
      const scopeInfo = resolveChatScope(socket);
      if (scopeInfo) {
        await socket.leave(`chat:${scopeInfo.scope}:${scopeInfo.scopeId}:${channelId}`);
      }
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'invalid_payload' });
    }
  });

  socket.on('chat:typing', (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      if (isSupportSession) {
        ack?.({ ok: false, error: 'forbidden' });
        return;
      }
      const { channelId, isTyping } = chatTypingSchema.parse(payload);
      const scopeInfo = resolveChatScope(socket);
      const room = scopeInfo ? `chat:${scopeInfo.scope}:${scopeInfo.scopeId}:${channelId}` : null;
      if (!scopeInfo || !room || !socket.rooms.has(room)) {
        ack?.({ ok: false, error: 'not_in_channel' });
        return;
      }
      socket.to(room).emit('chat:typing', {
        scope: scopeInfo.scope,
        channelId,
        actorId: user.id,
        isTyping,
      });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'invalid_payload' });
    }
  });
}

export function handleChatDisconnect(io: Server, socket: Socket): void {
  const scopeInfo = resolveChatScope(socket);
  const userId = getSocketAuthState(socket).user?.id;
  if (!scopeInfo || !userId) return;

  const actorRoom =
    scopeInfo.scope === 'platform'
      ? `staff:${userId}`
      : `workspace-user:${scopeInfo.scopeId}:${userId}`;
  const broadcastRoom =
    scopeInfo.scope === 'platform' ? 'platform:chat' : `tenant-chat:${scopeInfo.scopeId}`;

  void io
    .in(actorRoom)
    .fetchSockets()
    .then((sockets) => {
      if (sockets.length === 0) {
        return chatRepo
          .setActorPresence(scopeInfo.scope, scopeInfo.scopeId, userId, false)
          .then(() => {
            io.to(broadcastRoom).emit('chat:presence', {
              scope: scopeInfo.scope,
              actorId: userId,
              online: false,
            });
          });
      }
    })
    .catch(() => {});
}
