import { Redis } from 'ioredis';
import { env } from '@/config/env.js';
import { logger } from '@/config/logger.js';

export interface CreateRedisOptions {
  forBull?: boolean;
  url?: string;
}

/**
 * forBull: BullMQ workers/blocking commands REQUIRE maxRetriesPerRequest = null.
 * For everything else (cache, rate limit) we fail fast instead of hanging requests when Redis is down.
 */
export function createRedis(
  name: string,
  { forBull = false, url = env.REDIS_URL }: CreateRedisOptions = {},
): Redis {
  const client = new Redis(url, {
    connectionName: `${env.APP_NAME}:${name}`,
    maxRetriesPerRequest: forBull ? null : 2,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(times * 200, 3000),
  });
  client.on('error', (err: Error) => logger.error({ err, redis: name }, 'redis error'));
  client.on('ready', () => logger.info({ redis: name }, 'redis ready'));
  return client;
}

// State Redis holds refresh tokens and rate-limit counters; it must not evict.
export const redis: Redis = createRedis('state');
// Cache Redis may use an eviction policy without affecting authentication state.
export const cacheRedis: Redis = createRedis('cache', { url: env.CACHE_REDIS_URL });

export async function closeRedisClients(): Promise<void> {
  await Promise.allSettled([redis.quit(), cacheRedis.quit()]);
}
