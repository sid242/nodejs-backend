import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { closeDb, db } from '@/config/db';

try {
  await migrate(db, { migrationsFolder: './drizzle' });
} finally {
  await closeDb();
}
