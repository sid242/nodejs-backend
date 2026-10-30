import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { createRedis, redis } from '@/config/redis';
import { ACCESS_TOKEN_COOKIE } from '@/constants/index';
import { dynamicCorsOrigin } from '@/lib/cors';
import { parseCookies } from '@/modules/auth/cookies';
import { verifyAccessToken, verifySupportToken } from '@/modules/auth/tokens';
import * as platformRepo from '@/modules/platform/platform.repository';

const roomSchema = z.object({ roomId: z.string().min(1).max(64) });
const messageSchema = roomSchema.extend({ text: z.string().min(1).max(2000) });

async function consumeRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const bucket = `socket:rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  const count = await redis.incr(bucket);
  if (count === 1) await redis.pexpire(bucket, windowMs);
  return count <= limit;
}

export interface SocketUser {
  id: string;
}

export interface SocketManager {
  io: Server;
  close: () => Promise<void>;
}

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

  // Authenticate during the handshake: client passes io(url, { auth: { token } }) or browser cookies.
  io.use((socket: Socket, next) => {
    void (async () => {
      let token = socket.handshake.auth?.token;
      if (!token && socket.handshake.headers.cookie) {
        const cookies = parseCookies(socket.handshake.headers.cookie);
        token = cookies['support_at'] || cookies[ACCESS_TOKEN_COOKIE];
      }
      if (!token) throw new Error('unauthorized');

      try {
        const supportPayload = verifySupportToken(token);
        const session = await platformRepo.findSupportSessionById(supportPayload.sess);
        if (!session || session.status !== 'ACTIVE' || new Date(session.expiresAt) <= new Date()) {
          throw new Error('unauthorized');
        }
        socket.data.isSupportSession = true;
        socket.data.supportSession = session;
        socket.data.user = { id: session.targetUserId ?? session.staffId };
        return next();
      } catch {
        // Continue to verify standard user token
      }

      const payload = verifyAccessToken(token);
      if (payload?.typ !== 'USER') throw new Error('unauthorized');

      const allowed = await consumeRateLimit(
        `connect:${payload.sub}`,
        env.SOCKET_CONNECTIONS_PER_MINUTE,
        60_000,
      );
      if (!allowed) throw new Error('rate_limited');
      socket.data.user = { id: payload.sub as string };
      next();
    })().catch(() => next(new Error('unauthorized')));
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as SocketUser;
    const userId = user?.id;
    if (userId) {
      socket.join(`user:${userId}`); // personal room: lets workers target a user from anywhere
    }

    if (socket.data.isSupportSession && socket.data.supportSession) {
      const sess = socket.data.supportSession;
      socket.join(`session:${sess.id}`);
      socket.join(`tenant:${sess.tenantId}`);
      logger.info(
        { userId, staffId: sess.staffId, sessionId: sess.id, socketId: socket.id },
        'support session socket connected',
      );
    } else {
      logger.debug({ userId, socketId: socket.id }, 'socket connected');
    }

    // Per-socket flood guard (a socket lives on exactly one node, so in-memory is fine).
    let windowStart = Date.now();
    let count = 0;
    socket.use((_packet, next) => {
      void (async () => {
        const now = Date.now();
        if (now - windowStart > 1000) {
          windowStart = now;
          count = 0;
        }
        if (++count > env.SOCKET_EVENTS_PER_SECOND) throw new Error('rate_limited');
        const allowed = await consumeRateLimit(
          `event:${userId}`,
          env.SOCKET_EVENTS_PER_SECOND,
          1000,
        );
        if (!allowed) throw new Error('rate_limited');
        next();
      })().catch(() => next(new Error('rate_limited')));
    });

    /**
     * Room authorization guard:
     * - Private user rooms ('user:*') require matching user ID.
     * - Public rooms ('public:*' or generic IDs) can be joined by authenticated users.
     */
    async function authorizeRoomAccess(u: SocketUser, roomId: string): Promise<boolean> {
      if (roomId.startsWith('user:') && roomId !== `user:${u.id}`) {
        return false;
      }
      return true;
    }

    socket.on('room:join', async (payload: any, ack?: (res: any) => void) => {
      try {
        const { roomId } = roomSchema.parse(payload);
        const authorized = await authorizeRoomAccess(socket.data.user, roomId);
        if (!authorized) {
          ack?.({ ok: false, error: 'forbidden' });
          return;
        }
        socket.join(`room:${roomId}`);
        ack?.({ ok: true });
      } catch (err: any) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('room:leave', (payload: any, ack?: (res: any) => void) => {
      try {
        const { roomId } = roomSchema.parse(payload);
        socket.leave(`room:${roomId}`);
        ack?.({ ok: true });
      } catch (err: any) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('room:message', (payload: any, ack?: (res: any) => void) => {
      try {
        const { roomId, text } = messageSchema.parse(payload);
        if (!socket.rooms.has(`room:${roomId}`)) {
          ack?.({ ok: false, error: 'not_in_room' });
          return;
        }
        io.to(`room:${roomId}`).emit('room:message', {
          roomId,
          text,
          from: userId,
          at: Date.now(),
        });
        ack?.({ ok: true });
      } catch (err: any) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('error', (err) => logger.warn({ err, userId }, 'socket error'));
    socket.on('disconnect', (reason) => logger.debug({ userId, reason }, 'socket disconnected'));
  });

  return {
    io,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}
