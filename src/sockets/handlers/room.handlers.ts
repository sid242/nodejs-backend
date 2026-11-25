import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

import { loadActiveSupportAccess } from '@/modules/platform/support-access';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

import { getSocketAuthState } from '../types';

const roomSchema = z.object({ roomId: z.string().min(1).max(64) });
const messageSchema = roomSchema.extend({ text: z.string().min(1).max(2000) });

async function authorizeRoomAccess(socket: Socket, roomId: string): Promise<boolean> {
  if (roomId.startsWith('chat:') || roomId.startsWith('staff:') || roomId.startsWith('platform:')) {
    return false;
  }

  const { actorType, user, supportSession, supportClaims, workspaceTenantId } =
    getSocketAuthState(socket);

  if (supportSession && supportClaims) {
    await loadActiveSupportAccess(supportClaims);
    return (
      roomId === `session:${supportSession.id}` || roomId === `tenant:${supportSession.tenantId}`
    );
  }

  if (actorType === 'STAFF') return false;
  if (roomId.startsWith('user:') && roomId !== `user:${user.id}`) {
    return false;
  }
  if (roomId.startsWith('session:')) {
    return false;
  }
  if (roomId.startsWith('tenant:')) {
    const tenantId = roomId.slice('tenant:'.length);
    if (!workspaceTenantId || tenantId !== workspaceTenantId) return false;

    try {
      const member = await tenantsRepo.findTenantMember(tenantId, user.id);
      return Boolean(member && member.status === 'ACTIVE');
    } catch {
      return false;
    }
  }
  return true;
}

export function registerRoomHandlers(io: Server, socket: Socket): void {
  const { user, supportSession } = getSocketAuthState(socket);

  socket.on('room:join', async (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const { roomId } = roomSchema.parse(payload);
      const authorized = await authorizeRoomAccess(socket, roomId);
      if (!authorized) {
        ack?.({ ok: false, error: 'forbidden' });
        return;
      }
      await socket.join(`room:${roomId}`);
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'invalid_payload' });
    }
  });

  socket.on('room:leave', async (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const { roomId } = roomSchema.parse(payload);
      await socket.leave(`room:${roomId}`);
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'invalid_payload' });
    }
  });

  socket.on('room:message', async (payload: unknown, ack?: (res: unknown) => void) => {
    try {
      const { roomId, text } = messageSchema.parse(payload);
      if (
        supportSession?.scope === 'READ_ONLY' ||
        !socket.rooms.has(`room:${roomId}`) ||
        !(await authorizeRoomAccess(socket, roomId))
      ) {
        ack?.({ ok: false, error: 'not_in_room' });
        return;
      }
      io.to(`room:${roomId}`).emit('room:message', {
        roomId,
        text,
        from: user.id,
        at: Date.now(),
      });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'invalid_payload' });
    }
  });
}
