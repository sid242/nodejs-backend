import { Emitter } from '@socket.io/redis-emitter';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { createRedis } from '@/config/redis';

// Lets ANY process (workers, cron, other services) push events to connected clients via Redis,
// without running a Socket.IO server itself.
const emitterClient = createRedis('sio-emitter', { url: env.SOCKET_REDIS_URL });
const emitter = new Emitter(emitterClient);

export const emitToUser = (userId: string, event: string, payload: unknown): void => {
  emitter?.to?.(`user:${userId}`)?.emit?.(event, payload);
  void emitterClient?.publish?.(`sse:user:${userId}`, JSON.stringify({ event, payload }));
};

export function emitToWorkspaceUser(
  tenantId: string,
  userId: string,
  event: string,
  payload: Record<string, unknown>,
): void {
  const room = `workspace-user:${tenantId}:${userId}`;
  emitter.to(room).emit(event, payload);
  void emitterClient.publish(`sse:${room}`, JSON.stringify({ event, payload }));
}

export const emitToRoom = (room: string, event: string, payload: unknown): void => {
  emitter.to(`room:${room}`).emit(event, payload);
};

export const emitToStaff = (staffId: string, event: string, payload: unknown): void => {
  emitter?.to?.(`staff:${staffId}`)?.emit?.(event, payload);
};

export const emitToChatChannel = (
  scope: 'tenant' | 'platform',
  scopeId: string,
  channelId: string,
  event: string,
  payload: unknown,
): void => {
  emitter?.to?.(`chat:${scope}:${scopeId}:${channelId}`)?.emit?.(event, payload);
};

export const emitToChatScope = (
  scope: 'tenant' | 'platform',
  scopeId: string,
  event: string,
  payload: unknown,
): void => {
  const room = scope === 'tenant' ? `tenant-chat:${scopeId}` : 'platform:chat';
  emitter?.to?.(room)?.emit?.(event, payload);
};

export const emitToChatActor = (
  scope: 'tenant' | 'platform',
  scopeId: string,
  actorId: string,
  event: string,
  payload: Record<string, unknown>,
): void => {
  if (scope === 'tenant') {
    emitToWorkspaceUser(scopeId, actorId, event, payload);
  } else {
    emitToStaff(actorId, event, payload);
  }
};

export const closeSocketEmitter = (): Promise<string> => emitterClient.quit();

export function disconnectWorkspaceMember(tenantId: string, userId: string): void {
  const room = `workspace-user:${tenantId}:${userId}`;
  emitter.in(room).disconnectSockets(true);
  void emitterClient
    .publish(`sse:${room}`, JSON.stringify({ event: 'workspace:revoked' }))
    .catch((err: unknown) => logger.error({ err, tenantId }, 'Could not end workspace stream'));
}

export function disconnectSupportSession(sessionId: string): void {
  emitter.in(`session:${sessionId}`).disconnectSockets(true);
}
