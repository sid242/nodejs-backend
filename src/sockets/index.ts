import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';

import { env } from '@/config/env';
import { createRedis } from '@/config/redis';
import { dynamicCorsOrigin } from '@/lib/cors';

import { authenticateSocket } from './auth';
import { registerConnectionLifecycle } from './lifecycle';
import type { SocketManager } from './types';

export type { SocketActorType, SocketManager, SocketUser } from './types';

export function initSocket(httpServer: HttpServer): SocketManager {
  const pub = createRedis('sio-pub', { url: env.SOCKET_REDIS_URL });
  // Create separately so readiness/error logging applies to both adapter clients.
  const sub = createRedis('sio-sub', { url: env.SOCKET_REDIS_URL });

  const io = new Server(httpServer, {
    cors: { origin: dynamicCorsOrigin, credentials: true },
    // websocket-only => no sticky sessions needed behind the load balancer.
    transports: ['websocket'],
    // Redis adapter => rooms/broadcasts work across all API replicas.
    adapter: createAdapter(pub, sub),
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1e5,
  });

  io.use(authenticateSocket);
  io.on('connection', (socket) => registerConnectionLifecycle(io, socket));

  return {
    io,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}
