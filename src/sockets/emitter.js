import { Emitter } from '@socket.io/redis-emitter';
import { createRedis } from '../config/redis.js';
import { env } from '../config/env.js';

// Lets ANY process (workers, cron, other services) push events to connected clients via Redis,
// without running a Socket.IO server itself.
const emitterClient = createRedis('sio-emitter', { url: env.SOCKET_REDIS_URL });
const emitter = new Emitter(emitterClient);

export const emitToUser = (userId, event, payload) =>
  emitter.to(`user:${userId}`).emit(event, payload);
export const emitToRoom = (room, event, payload) => emitter.to(`room:${room}`).emit(event, payload);

export const closeSocketEmitter = () => emitterClient.quit();
