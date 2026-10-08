import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { z } from 'zod';
import { env } from '../config/env.js';
import { createRedis, redis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { parseList } from '../lib/utils.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

const roomSchema = z.object({ roomId: z.string().min(1).max(64) });
const messageSchema = roomSchema.extend({ text: z.string().min(1).max(2000) });

async function consumeRateLimit(key, limit, windowMs) {
  const bucket = `socket:rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  const count = await redis.incr(bucket);
  if (count === 1) await redis.pexpire(bucket, windowMs);
  return count <= limit;
}

export function initSocket(httpServer) {
  const pub = createRedis('sio-pub', { url: env.SOCKET_REDIS_URL });
  // Create separately so readiness/error logging applies to both adapter clients.
  const sub = createRedis('sio-sub', { url: env.SOCKET_REDIS_URL });

  const io = new Server(httpServer, {
    cors: { origin: parseList(env.CORS_ORIGINS), credentials: true },
    // websocket-only => no sticky sessions needed behind the load balancer.
    transports: ['websocket'],
    // Redis adapter => rooms/broadcasts work across all API replicas.
    adapter: createAdapter(pub, sub),
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1e5,
  });

  // Authenticate during the handshake: client passes io(url, { auth: { token } }).
  io.use((socket, next) => {
    void (async () => {
      const payload = verifyAccessToken(socket.handshake.auth?.token);
      const allowed = await consumeRateLimit(
        `connect:${payload.sub}`,
        env.SOCKET_CONNECTIONS_PER_MINUTE,
        60_000,
      );
      if (!allowed) throw new Error('rate_limited');
      socket.data.user = { id: payload.sub, role: payload.role };
      next();
    })().catch(() => next(new Error('unauthorized')));
  });

  io.on('connection', (socket) => {
    const { id: userId } = socket.data.user;
    socket.join(`user:${userId}`); // personal room: lets workers target a user from anywhere
    logger.debug({ userId, socketId: socket.id }, 'socket connected');

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
     * - Admin rooms ('admin:*') require ADMIN role.
     * - Private user rooms ('user:*') require matching user ID.
     * - Public rooms ('public:*' or generic IDs) can be joined by authenticated users.
     */
    async function authorizeRoomAccess(user, roomId) {
      if (roomId.startsWith('admin:') && user.role !== 'ADMIN') {
        return false;
      }
      if (roomId.startsWith('user:') && roomId !== `user:${user.id}`) {
        return false;
      }
      return true;
    }

    socket.on('room:join', async (payload, ack) => {
      try {
        const { roomId } = roomSchema.parse(payload);
        const authorized = await authorizeRoomAccess(socket.data.user, roomId);
        if (!authorized) {
          ack?.({ ok: false, error: 'forbidden' });
          return;
        }
        socket.join(`room:${roomId}`);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('room:leave', (payload, ack) => {
      try {
        const { roomId } = roomSchema.parse(payload);
        socket.leave(`room:${roomId}`);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('room:message', (payload, ack) => {
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
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('error', (err) => logger.warn({ err, userId }, 'socket error'));
    socket.on('disconnect', (reason) => logger.debug({ userId, reason }, 'socket disconnected'));
  });

  return {
    io,
    async close() {
      await new Promise((resolve) => io.close(resolve));
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}
