import { randomUUID } from 'node:crypto';
import { cacheRedis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { sleep } from './utils.js';

const PREFIX = 'cache:';
const RELEASE_LOCK_IF_OWNER =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0';

/**
 * Cache-aside helper on Redis.
 * - Fails OPEN: if Redis is down we log and hit the source of truth instead of erroring.
 * - wrap() has stampede protection (one caller rebuilds, others wait briefly).
 */
export const cache = {
  async get(key) {
    try {
      const raw = await cacheRedis.get(PREFIX + key);
      return raw === null ? null : JSON.parse(raw);
    } catch (err) {
      logger.warn({ err, key }, 'cache get failed');
      return null;
    }
  },

  async set(key, value, ttlSeconds = 60) {
    try {
      await cacheRedis.set(PREFIX + key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      logger.warn({ err, key }, 'cache set failed');
    }
  },

  async del(...keys) {
    if (!keys.length) return;
    try {
      await cacheRedis.del(keys.map((k) => PREFIX + k));
    } catch (err) {
      logger.warn({ err, keys }, 'cache del failed');
    }
  },

  /** Invalidate a group of keys, e.g. delByPrefix('users:list:'). Uses SCAN (never KEYS). */
  async delByPrefix(prefix) {
    try {
      const stream = cacheRedis.scanStream({ match: `${PREFIX}${prefix}*`, count: 200 });
      for await (const keys of stream) {
        if (keys.length) await cacheRedis.unlink(keys);
      }
    } catch (err) {
      logger.warn({ err, prefix }, 'cache delByPrefix failed');
    }
  },

  async wrap(key, ttlSeconds, loader) {
    const hit = await this.get(key);
    if (hit !== null) return hit;

    const lockKey = `${PREFIX}lock:${key}`;
    const lockToken = randomUUID();
    let locked = false;
    try {
      locked =
        (await cacheRedis.set(lockKey, lockToken, 'EX', env.CACHE_LOCK_TTL_SECONDS, 'NX')) === 'OK';
    } catch {
      /* redis down: just load */
    }

    if (!locked) {
      // Someone else is rebuilding; poll briefly, then fall through and load ourselves.
      for (let i = 0; i < 10; i++) {
        await sleep(100);
        const v = await this.get(key);
        if (v !== null) return v;
      }
    }

    try {
      const fresh = await loader();
      if (fresh !== undefined && fresh !== null) await this.set(key, fresh, ttlSeconds);
      return fresh;
    } finally {
      // Never delete a replacement lock acquired after ours expired.
      if (locked) await cacheRedis.eval(RELEASE_LOCK_IF_OWNER, 1, lockKey, lockToken).catch(() => {});
    }
  },
};
