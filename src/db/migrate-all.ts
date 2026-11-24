import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { closeDb, db, type Database } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import * as schema from '@/db/schema';
import { getLatestSchemaTag } from '@/db/schema-version';
import { applyTenantRlsPolicies } from '@/db/tenancy/rls';
import { TENANT_TABLES } from '@/db/tenancy/tenant-tables';
import { getSecretStore } from '@/lib/secrets';

interface MigrationFailure {
  tenantId: string;
  tenantName: string;
  databaseKey: string;
  error: string;
}

/**
 * Runs Drizzle migrations across the primary cluster and every active dedicated tenant database.
 * Used in CI/CD and ECS pre-deploy tasks before routing traffic to newly deployed API tasks.
 */
export async function runFleetMigrations(): Promise<void> {
  const latestTag = getLatestSchemaTag();
  logger.info(
    { latestTag },
    'Initiating fleet database migration across primary and dedicated tenants',
  );

  // 1. Migrate primary database
  logger.info('Migrating primary PostgreSQL database...');
  let primaryMigClient: postgres.Sql | null = null;
  let primaryMigDb = db;
  if (env.DATABASE_MIGRATION_URL) {
    primaryMigClient = postgres(env.DATABASE_MIGRATION_URL, { max: 1 });
    primaryMigDb = drizzle({ client: primaryMigClient, schema }) as unknown as Database;
  }
  try {
    await migrate(primaryMigDb, { migrationsFolder: './drizzle' });
    logger.info({ latestTag }, 'Primary database migration succeeded');
  } catch (err) {
    logger.fatal({ err }, 'Primary database migration failed. Aborting fleet migrations.');
    throw err;
  } finally {
    if (primaryMigClient) {
      await primaryMigClient.end({ timeout: 5 }).catch(() => {});
    }
  }

  // 2. Query all active dedicated tenants
  const dedicatedTenants = await db
    .select({
      id: schema.tenants.id,
      name: schema.tenants.name,
      databaseKey: schema.tenants.databaseKey,
      databaseSecretRef: schema.tenants.databaseSecretRef,
      schemaVersion: schema.tenants.schemaVersion,
      metadata: schema.tenants.metadata,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.databaseMode, 'dedicated'));

  logger.info(
    { totalDedicatedTenants: dedicatedTenants.length },
    'Discovered dedicated tenant databases for schema migration',
  );

  if (dedicatedTenants.length === 0) {
    logger.info('No dedicated tenant databases found. Fleet migration complete.');
    return;
  }

  const failures: MigrationFailure[] = [];
  const secretStore = getSecretStore();
  const concurrency = 3;

  // Process tenants with bounded concurrency (3 at a time)
  for (let i = 0; i < dedicatedTenants.length; i += concurrency) {
    const chunk = dedicatedTenants.slice(i, i + concurrency);

    await Promise.all(
      chunk.map(async (tenant) => {
        logger.info(
          { tenantId: tenant.id, tenantName: tenant.name, currentVersion: tenant.schemaVersion },
          'Migrating dedicated tenant database',
        );

        // Record operation start in tenant_db_operations
        const [opRecord] = await db
          .insert(schema.tenantDbOperations)
          .values({
            tenantId: tenant.id,
            kind: 'MIGRATE_SCHEMA',
            status: 'RUNNING',
            reason: `Fleet migration to schema version ${latestTag}`,
            params: { targetVersion: latestTag, previousVersion: tenant.schemaVersion },
            startedAt: new Date(),
          })
          .returning();

        let client: postgres.Sql | null = null;
        try {
          // Resolve connection string from SecretStore or fallback URL
          let connectionUrl: string | null = null;
          if (tenant.databaseSecretRef) {
            try {
              connectionUrl = await secretStore.get(tenant.databaseSecretRef);
            } catch (err) {
              logger.warn(
                { tenantId: tenant.id, err },
                'Failed to retrieve connection URL from secret store, falling back to metadata',
              );
            }
          }

          if (!connectionUrl) {
            const meta = tenant.metadata as Record<string, unknown> | null;
            const dbName =
              (meta?.databaseName as string) || `tenant_${tenant.id.replace(/-/g, '_')}`;
            const targetUrl = new URL(env.DATABASE_URL);
            targetUrl.pathname = `/${dbName}`;
            connectionUrl = targetUrl.toString();
          }

          client = postgres(connectionUrl, { max: 2, idle_timeout: 10 });
          const tenantDb = drizzle({ client, schema }) as unknown as Database;

          // Run Drizzle migration
          await migrate(tenantDb, { migrationsFolder: './drizzle' });

          // Apply RLS policies and role grants
          await applyTenantRlsPolicies(client, TENANT_TABLES);

          // Update tenant's schemaVersion in primary DB
          await db
            .update(schema.tenants)
            .set({
              schemaVersion: latestTag,
              metadata: {
                ...((tenant.metadata as Record<string, unknown> | null) ?? {}),
                lastMigrationAt: new Date().toISOString(),
                migrationStatus: 'UP_TO_DATE',
              },
            })
            .where(eq(schema.tenants.id, tenant.id));

          // Mark operation as SUCCEEDED
          if (opRecord) {
            await db
              .update(schema.tenantDbOperations)
              .set({
                status: 'SUCCEEDED',
                finishedAt: new Date(),
                progress: { currentStep: 'COMPLETED', percent: 100 },
              })
              .where(eq(schema.tenantDbOperations.id, opRecord.id));
          }

          logger.info(
            { tenantId: tenant.id, tenantName: tenant.name, newVersion: latestTag },
            'Dedicated tenant database migration completed successfully',
          );
        } catch (err: unknown) {
          const errMsg = (err as Error)?.message ?? 'Unknown migration error';
          logger.error(
            { tenantId: tenant.id, tenantName: tenant.name, error: errMsg },
            'Dedicated tenant database migration failed',
          );

          failures.push({
            tenantId: tenant.id,
            tenantName: tenant.name,
            databaseKey: tenant.databaseKey,
            error: errMsg,
          });

          // Mark operation as FAILED
          if (opRecord) {
            await db
              .update(schema.tenantDbOperations)
              .set({
                status: 'FAILED',
                finishedAt: new Date(),
                error: errMsg,
              })
              .where(eq(schema.tenantDbOperations.id, opRecord.id));
          }
        } finally {
          if (client) {
            await client.end({ timeout: 5 }).catch(() => {});
          }
        }
      }),
    );
  }

  if (failures.length > 0) {
    logger.error(
      { failureCount: failures.length, failures },
      'Fleet migrations encountered failures on dedicated tenant databases',
    );
    throw new Error(
      `Fleet migrations failed for ${failures.length} dedicated tenant(s): ${failures.map((f) => `${f.tenantName} (${f.tenantId})`).join(', ')}`,
    );
  }

  logger.info(
    { totalMigrated: dedicatedTenants.length },
    'Fleet migrations completed successfully',
  );
}

// CLI entrypoint
if (process.argv[1]?.includes('migrate-all')) {
  runFleetMigrations()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.fatal({ err }, 'Fleet migration process exited with error');
      await closeDb().catch(() => {});
      process.exit(1);
    });
}
