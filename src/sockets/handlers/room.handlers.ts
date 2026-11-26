import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

import { loadActiveSupportAccess } from '@/modules/platform/support-access';
import { resolveUserPermissions, SYSTEM_ROLES } from '@/modules/rbac/rbac.service';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

import { getSocketAuthState } from '../types';

const roomSchema = z.object({ roomId: z.string().min(1).max(64) });
const messageSchema = roomSchema.extend({ text: z.string().min(1).max(2000) });

export interface RoomAuthDependencies {
  findTenantMember: typeof tenantsRepo.findTenantMember;
  resolveUserPermissions: typeof resolveUserPermissions;
}

export const defaultRoomAuthDeps: RoomAuthDependencies = {
  findTenantMember: tenantsRepo.findTenantMember,
  resolveUserPermissions,
};

export async function authorizeRoomAccess(
  socket: Socket,
  roomId: string,
  deps: RoomAuthDependencies = defaultRoomAuthDeps,
): Promise<boolean> {
  if (roomId.startsWith('chat:') || roomId.startsWith('staff:') || roomId.startsWith('platform:')) {
    return false;
  }

  const { actorType, user, supportSession, supportClaims, workspaceTenantId } =
    getSocketAuthState(socket);

  if (supportSession && supportClaims) {
    await loadActiveSupportAccess(supportClaims);
    return (
      roomId === `session:${supportSession.id}` ||
      roomId === `tenant:${supportSession.tenantId}` ||
      roomId === `tenant:${supportSession.tenantId}:whatsapp`
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
    const parts = roomId.split(':');
    const tenantId = parts[1];
    const subScope = parts[2];

    if (!workspaceTenantId || tenantId !== workspaceTenantId) return false;

    try {
      const member = await deps.findTenantMember(tenantId, user.id);
      if (!member || member.status !== 'ACTIVE') return false;

      // Dedicated privacy-restricted rooms
      if (subScope === 'whatsapp') {
        const resolved = await deps.resolveUserPermissions(tenantId, user.id);
        const perms = resolved.permissions;
        const isOwner = resolved.roles.includes(SYSTEM_ROLES.OWNER);
        return isOwner || perms.includes('*') || perms.includes('whatsapp:conversation:read');
      }

      return true;
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
