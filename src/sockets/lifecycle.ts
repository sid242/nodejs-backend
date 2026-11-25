import type { Server, Socket } from 'socket.io';

import { logger } from '@/config/logger';
import * as platformRepo from '@/modules/platform/platform.repository';
import { loadActiveSupportAccess } from '@/modules/platform/support-access';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

import {
  handleChatDisconnect,
  joinChatPresenceRooms,
  refreshChatPresence,
  registerChatHandlers,
} from './handlers/chat.handlers';
import { registerRoomHandlers } from './handlers/room.handlers';
import { attachSocketEventRateLimiter } from './rate-limit';
import { getSocketAuthState } from './types';

function startAccessMonitorTimer(socket: Socket): ReturnType<typeof setInterval> | undefined {
  const { actorType, user, workspaceTenantId, supportSession, supportClaims } =
    getSocketAuthState(socket);
  const userId = user?.id;
  if (!userId) return undefined;

  if (actorType === 'STAFF') {
    return setInterval(() => {
      void (async () => {
        const staff = await platformRepo.findStaffById(userId);
        if (!staff || staff.status !== 'ACTIVE') {
          socket.disconnect(true);
          return;
        }
        await refreshChatPresence(socket);
      })().catch(() => socket.disconnect(true));
    }, 30_000);
  }

  if (workspaceTenantId) {
    return setInterval(() => {
      void (async () => {
        if (supportSession && supportClaims) {
          await loadActiveSupportAccess(supportClaims);
          return;
        }
        const [tenant, member] = await Promise.all([
          tenantsRepo.findTenantById(workspaceTenantId),
          tenantsRepo.findTenantMember(workspaceTenantId, userId),
        ]);
        if (
          !tenant ||
          tenant.deletedAt ||
          !['ACTIVE', 'TRIALING'].includes(tenant.status) ||
          member?.status !== 'ACTIVE'
        ) {
          socket.disconnect(true);
          return;
        }
        await refreshChatPresence(socket);
      })().catch(() => socket.disconnect(true));
    }, 30_000);
  }

  return undefined;
}

export function registerConnectionLifecycle(io: Server, socket: Socket): void {
  const { actorType, user, supportSession } = getSocketAuthState(socket);
  const userId = user?.id;

  joinChatPresenceRooms(io, socket);

  if (supportSession) {
    void socket.join(`session:${supportSession.id}`);
    void socket.join(`tenant:${supportSession.tenantId}`);
    logger.info(
      {
        userId,
        staffId: supportSession.staffId,
        sessionId: supportSession.id,
        socketId: socket.id,
      },
      'support session socket connected',
    );
  } else {
    logger.debug({ userId, actorType, socketId: socket.id }, 'socket connected');
  }

  const expiryTimer = supportSession
    ? setTimeout(
        () => socket.disconnect(true),
        Math.max(0, new Date(supportSession.expiresAt).getTime() - Date.now()),
      )
    : undefined;

  const accessTimer = startAccessMonitorTimer(socket);

  if (userId) {
    attachSocketEventRateLimiter(socket, actorType, userId);
  }

  registerChatHandlers(socket);
  registerRoomHandlers(io, socket);

  socket.on('error', (err) => logger.warn({ err, userId }, 'socket error'));
  socket.on('disconnect', (reason) => {
    clearTimeout(expiryTimer);
    clearInterval(accessTimer);
    handleChatDisconnect(io, socket);
    logger.debug({ userId, actorType, reason }, 'socket disconnected');
  });
}
