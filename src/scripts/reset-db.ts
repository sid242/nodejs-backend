import postgres from 'postgres';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { cacheRedis, closeRedisClients, redis } from '@/config/redis';

async function resetDatabase() {
  logger.info('====================================================');
  logger.info('          Complete Database & Cache Reset           ');
  logger.info('====================================================');

  const client = postgres(env.DATABASE_MIGRATION_URL || env.DATABASE_URL, { max: 1 });

  try {
    logger.info('1. Dropping and recreating public and drizzle schemas in PostgreSQL...');
    const pgUser = process.env.POSTGRES_USER || 'app';
    await client.unsafe(`
      DROP SCHEMA IF EXISTS public CASCADE;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO ${pgUser};
      GRANT ALL ON SCHEMA public TO public;
    `);
    logger.info('   ✔ PostgreSQL public and drizzle schemas dropped and recreated successfully.');

    logger.info('2. Flushing Redis databases (cache, state)...');
    try {
      await redis.flushall();
      await cacheRedis.flushall();
      logger.info('   ✔ Redis databases flushed completely.');
    } catch (redisErr) {
      logger.warn({ err: redisErr }, 'Redis flush warning');
    }

    logger.info('Database reset complete.');
  } finally {
    await client.end({ timeout: 5 }).catch(() => {});
    await closeRedisClients().catch(() => {});
  }
}

resetDatabase()
  .then(() => {
    logger.info('Reset script finished successfully.');
    process.exit(0);
  })
  .catch((err) => {
    logger.fatal({ err }, 'Failed to reset database');
    process.exit(1);
  });
