import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { closeDb, db } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

const migrationUrl = env.DATABASE_MIGRATION_URL || env.DATABASE_URL;
let migrationClient: postgres.Sql | null = null;
let migrationDb = db;

if (env.DATABASE_MIGRATION_URL) {
  logger.info('Using dedicated DATABASE_MIGRATION_URL credentials for schema migration');
  migrationClient = postgres(migrationUrl, { max: 1 });
  migrationDb = drizzle({ client: migrationClient }) as any;
}

try {
  await migrate(migrationDb, { migrationsFolder: './drizzle' });
} finally {
  if (migrationClient) {
    await migrationClient.end({ timeout: 5 }).catch(() => {});
  }
  await closeDb().catch(() => {});
}
