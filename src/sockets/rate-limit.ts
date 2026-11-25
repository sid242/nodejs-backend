import type { Socket } from 'socket.io';

import { env } from '@/config/env';
import { redis } from '@/config/redis';

import type { SocketActorType } from './types';

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const bucket = `socket:rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  const count = await redis.incr(bucket);
  if (count === 1) await redis.pexpire(bucket, windowMs);
  return count <= limit;
}

/**
 * Guards every connected socket against per-second event flooding,
 * using both local in-memory windowing and cross-node Redis counters.
 */
export function attachSocketEventRateLimiter(
  socket: Socket,
  actorType: SocketActorType,
  userId: string,
): void {
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
        `event:${actorType}:${userId}`,
        env.SOCKET_EVENTS_PER_SECOND,
        1000,
      );
      if (!allowed) throw new Error('rate_limited');
      next();
    })().catch(() => next(new Error('rate_limited')));
  });
}
