import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from './env.js';

// Per-process pool caps prevent horizontal API/worker scaling from exhausting Postgres.
const client = postgres(env.DATABASE_URL, {
  max: env.DB_POOL_MAX,
  connect_timeout: env.DB_CONNECT_TIMEOUT_SECONDS,
  idle_timeout: env.DB_IDLE_TIMEOUT_SECONDS,
  max_lifetime: env.DB_MAX_LIFETIME_SECONDS,
});

export const db = drizzle({ client });
export const closeDb = () => client.end({ timeout: 5 });
