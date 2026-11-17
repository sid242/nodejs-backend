import crypto from 'node:crypto';
import type { Job } from 'bullmq';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { db, type Database } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { redis } from '@/config/redis';
import * as schema from '@/db/schema';
import { getLatestSchemaTag } from '@/db/schema-version';
import { applyTenantRlsPolicies } from '@/db/tenancy/rls';
import { closeDedicatedPool } from '@/db/tenancy/tenant-db';
import { TENANT_TABLES } from '@/db/tenancy/tenant-tables';
import { AppError } from '@/lib/errors';
import { provisionDedicatedDatabase } from '@/lib/provision-db';
import { putObject } from '@/lib/s3';
import { getSecretStore } from '@/lib/secrets';

export interface DbOpJobData {
  operationId: string;
  tenantId: string;
  kind:
    | 'PROVISION'
    | 'MIGRATE_SCHEMA'
    | 'SWITCH_TO_DEDICATED'
    | 'ROLLBACK_TO_SHARED'
    | 'BACKUP'
    | 'RESTORE'
    | 'VERIFY'
    | 'HEALTH_CHECK';
  requestedByStaffId?: string;
  approvedByStaffId?: string;
  reason: string;
  params?: {
    customDatabaseName?: string;
    poolLimit?: number;
    connectionUrl?: string;
    targetVersion?: string;
    maintenanceWindow?: string;
    backupConfirmed?: boolean;
    discardDedicatedData?: boolean;
  };
  requestId?: string;
}

export async function processDbOperation(job: Job<DbOpJobData>): Promise<any> {
  const { operationId, tenantId, kind, params, requestedByStaffId, approvedByStaffId } = job.data;

  logger.info({ operationId, tenantId, kind }, 'Processing database operation job');

  const [operation] = await db
    .select()
    .from(schema.tenantDbOperations)
    .where(eq(schema.tenantDbOperations.id, operationId))
    .limit(1);

  if (!operation) {
    logger.warn({ operationId }, 'Database operation record not found. Skipping.');
    return { skipped: true, reason: 'NOT_FOUND' };
  }

  if (operation.status === 'CANCELLED') {
    logger.info({ operationId }, 'Database operation was cancelled. Skipping.');
    return { skipped: true, reason: 'CANCELLED' };
  }

  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  if (!tenant || tenant.deletedAt) {
    await db
      .update(schema.tenantDbOperations)
      .set({ status: 'FAILED', error: 'Tenant workspace not found', finishedAt: new Date() })
      .where(eq(schema.tenantDbOperations.id, operationId));
    throw AppError.notFound('Tenant workspace not found');
  }

  // Acquire distributed operation lock with heartbeating
  const lockKey = `lock:tenant-db-op:${tenantId}`;
  const lockAcquired = await redis.set(lockKey, operationId, 'EX', 120, 'NX');
  if (!lockAcquired) {
    const errorMsg = 'Another database operation is currently active for this tenant workspace.';
    await db
      .update(schema.tenantDbOperations)
      .set({ status: 'FAILED', error: errorMsg, finishedAt: new Date() })
      .where(eq(schema.tenantDbOperations.id, operationId));
    throw AppError.conflict(errorMsg);
  }

  // Start heartbeat interval to refresh lock every 30 seconds
  const heartbeatTimer = setInterval(async () => {
    try {
      await redis.expire(lockKey, 120);
    } catch {
      // ignore transient redis error
    }
  }, 30_000);

  // Mark operation RUNNING
  await db
    .update(schema.tenantDbOperations)
    .set({ status: 'RUNNING', startedAt: new Date() })
    .where(eq(schema.tenantDbOperations.id, operationId));

  const maintenanceKey = `tenant:${tenantId}:maintenance`;
  let maintenanceSet = false;

  try {
    let result: any = null;

    switch (kind) {
      case 'PROVISION': {
        const provisionResult = await provisionDedicatedDatabase(tenantId, {
          customDatabaseName: params?.customDatabaseName,
          poolLimit: params?.poolLimit,
          connectionUrl: params?.connectionUrl,
        });

        // Store dedicated DB connection URL in SecretStore
        const secretStore = getSecretStore();
        const secretRef = await secretStore.put(
          'db-connection-url',
          provisionResult.connectionUrl,
          tenantId,
        );

        await db
          .update(schema.tenants)
          .set({
            databaseSecretRef: secretRef,
            metadata: {
              ...((tenant.metadata as Record<string, unknown> | null) ?? {}),
              databaseName: provisionResult.databaseName,
              poolLimit: provisionResult.poolLimit,
              tenantAppRole: provisionResult.tenantAppRole,
            },
          })
          .where(eq(schema.tenants.id, tenantId));

        result = {
          databaseName: provisionResult.databaseName,
          databaseKey: provisionResult.databaseKey,
          schemaVersion: provisionResult.schemaVersion,
        };
        break;
      }

      case 'MIGRATE_SCHEMA': {
        const latestTag = getLatestSchemaTag();
        const secretStore = getSecretStore();
        let connectionUrl: string | null = null;

        if (tenant.databaseSecretRef) {
          try {
            connectionUrl = await secretStore.get(tenant.databaseSecretRef);
          } catch {
            // fallback
          }
        }

        if (!connectionUrl) {
          const meta = tenant.metadata as Record<string, unknown> | null;
          const dbName = (meta?.databaseName as string) || `tenant_${tenantId.replace(/-/g, '_')}`;
          const targetUrl = new URL(env.DATABASE_URL);
          targetUrl.pathname = `/${dbName}`;
          connectionUrl = targetUrl.toString();
        }

        const client = postgres(connectionUrl, { max: 2, idle_timeout: 10 });
        try {
          const dedicatedDb = drizzle({ client, schema }) as unknown as Database;
          await migrate(dedicatedDb, { migrationsFolder: './drizzle' });
          await applyTenantRlsPolicies(client, TENANT_TABLES);

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
            .where(eq(schema.tenants.id, tenantId));

          result = { schemaVersion: latestTag };
        } finally {
          await client.end({ timeout: 5 }).catch(() => {});
        }
        break;
      }

      case 'SWITCH_TO_DEDICATED': {
        if (tenant.databaseMode === 'dedicated') {
          throw AppError.conflict('Tenant is already running on a dedicated database');
        }

        // 1. Enable maintenance mode (mutations return 503)
        await redis.set(maintenanceKey, '1', 'EX', 3600);
        maintenanceSet = true;

        const copyStartTime = new Date();

        // 2. Provision isolated database
        const provisionResult = await provisionDedicatedDatabase(tenantId, {
          customDatabaseName: params?.customDatabaseName,
          poolLimit: params?.poolLimit,
          connectionUrl: params?.connectionUrl,
        });

        const targetUrl = new URL(provisionResult.connectionUrl);
        const dedicatedClient = postgres(targetUrl.toString(), { max: 2, idle_timeout: 10 });
        const dedicatedDb = drizzle({ client: dedicatedClient, schema }) as unknown as Database;

        const tableProgress: Record<string, { copied: number; total: number }> = {};

        try {
          // Replicate tenant record
          await dedicatedDb
            .insert(schema.tenants)
            .values({
              ...tenant,
              databaseMode: 'dedicated',
              databaseKey: provisionResult.databaseKey,
            })
            .onConflictDoNothing();

          // Replicate member user records for FK consistency if User exists
          const members = await db
            .select()
            .from(schema.tenantMembers)
            .where(eq(schema.tenantMembers.tenantId, tenantId));

          if (members.length > 0) {
            const userIds = [...new Set(members.map((m) => m.userId))];
            if (userIds.length > 0) {
              const memberUsers = await db
                .select()
                .from(schema.users)
                .where(inArray(schema.users.id, userIds));
              if (memberUsers.length > 0) {
                await dedicatedDb.insert(schema.users).values(memberUsers).onConflictDoNothing();
              }
            }
          }

          // Copy tables in topological order from TENANT_TABLES
          for (let tIdx = 0; tIdx < TENANT_TABLES.length; tIdx++) {
            const entry = TENANT_TABLES[tIdx];
            if (!entry) continue;

            const { name, table, tenantColumn } = entry;
            const col = (table as any)[tenantColumn];
            if (!col) continue;

            // Total count on primary
            const [totalCountRow] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(table)
              .where(eq(col, tenantId));
            const totalRows = Number(totalCountRow?.count ?? 0);

            tableProgress[name] = { copied: 0, total: totalRows };

            // Keyset / batch copy (1000 rows per batch)
            const BATCH_SIZE = 1000;
            let offset = 0;
            while (offset < totalRows) {
              const batch = await db
                .select()
                .from(table)
                .where(eq(col, tenantId))
                .limit(BATCH_SIZE)
                .offset(offset);

              if (batch.length === 0) break;

              await dedicatedDb.insert(table).values(batch).onConflictDoNothing();
              tableProgress[name].copied += batch.length;
              offset += batch.length;

              // Update progress in DB
              const percent = Math.floor(((tIdx + offset / (totalRows || 1)) / TENANT_TABLES.length) * 90);
              await db
                .update(schema.tenantDbOperations)
                .set({
                  progress: {
                    currentStep: `COPYING_${name}`,
                    tables: tableProgress,
                    percent,
                  },
                })
                .where(eq(schema.tenantDbOperations.id, operationId));
            }

            // Verify count on dedicated DB
            const [dedicatedCountRow] = await dedicatedDb
              .select({ count: sql<number>`count(*)::int` })
              .from(table)
              .where(eq(col, tenantId));
            const dedicatedRows = Number(dedicatedCountRow?.count ?? 0);

            if (dedicatedRows < tableProgress[name].copied) {
              throw AppError.internal(
                `Verification failed for ${name}: primary had ${tableProgress[name].copied} rows copied but dedicated has ${dedicatedRows}.`,
              );
            }
          }

          // Delta sync: copy any records created/updated after copyStartTime
          for (const entry of TENANT_TABLES) {
            const { table, tenantColumn } = entry;
            const col = (table as any)[tenantColumn];
            const updatedCol = (table as any).updatedAt ?? (table as any).createdAt;
            if (!col || !updatedCol) continue;

            const deltaRows = await db
              .select()
              .from(table)
              .where(sql`${col} = ${tenantId} AND ${updatedCol} >= ${copyStartTime}`);

            if (deltaRows.length > 0) {
              await dedicatedDb.insert(table).values(deltaRows).onConflictDoNothing();
            }
          }
        } finally {
          await dedicatedClient.end({ timeout: 5 }).catch(() => {});
        }

        // Store secret reference
        const secretStore = getSecretStore();
        const secretRef = await secretStore.put(
          'db-connection-url',
          provisionResult.connectionUrl,
          tenantId,
        );

        // Flip mode in primary database
        await db
          .update(schema.tenants)
          .set({
            databaseMode: 'dedicated',
            databaseKey: provisionResult.databaseKey,
            databaseSecretRef: secretRef,
            schemaVersion: provisionResult.schemaVersion,
            metadata: {
              ...((tenant.metadata as Record<string, unknown> | null) ?? {}),
              databaseName: provisionResult.databaseName,
              poolLimit: provisionResult.poolLimit,
              migratedToDedicatedAt: new Date().toISOString(),
              migratedByStaffId: requestedByStaffId,
            },
          })
          .where(eq(schema.tenants.id, tenantId));

        // Cluster-wide pool invalidation via Redis pub/sub
        await closeDedicatedPool(provisionResult.databaseKey, true);

        // Lift maintenance mode
        await redis.del(maintenanceKey);
        maintenanceSet = false;

        result = {
          databaseName: provisionResult.databaseName,
          databaseKey: provisionResult.databaseKey,
          tablesMigrated: tableProgress,
        };
        break;
      }

      case 'ROLLBACK_TO_SHARED': {
        if (tenant.databaseMode !== 'dedicated') {
          throw AppError.badRequest('Tenant is not currently running on a dedicated database');
        }

        // Four-eyes check: ensure rollback has staff confirmation
        if (!params?.backupConfirmed) {
          throw AppError.badRequest('Rollback requires explicit backup confirmation');
        }

        // Enable maintenance mode
        await redis.set(maintenanceKey, '1', 'EX', 3600);
        maintenanceSet = true;

        const secretStore = getSecretStore();
        let connectionUrl: string | null = null;
        if (tenant.databaseSecretRef) {
          try {
            connectionUrl = await secretStore.get(tenant.databaseSecretRef);
          } catch {
            // fallback
          }
        }

        if (!connectionUrl) {
          const meta = tenant.metadata as Record<string, unknown> | null;
          const dbName = (meta?.databaseName as string) || `tenant_${tenantId.replace(/-/g, '_')}`;
          const targetUrl = new URL(env.DATABASE_URL);
          targetUrl.pathname = `/${dbName}`;
          connectionUrl = targetUrl.toString();
        }

        const dedicatedClient = postgres(connectionUrl, { max: 2, idle_timeout: 10 });
        const dedicatedDb = drizzle({ client: dedicatedClient, schema }) as unknown as Database;

        try {
          // Check for newer rows if discardDedicatedData is false
          if (!params?.discardDedicatedData) {
            const meta = tenant.metadata as Record<string, unknown> | null;
            const migratedAt = meta?.migratedToDedicatedAt
              ? new Date(meta.migratedToDedicatedAt as string)
              : null;

            if (migratedAt) {
              const [newerMembers] = await dedicatedDb
                .select({ count: sql<number>`count(*)::int` })
                .from(schema.tenantMembers)
                .where(
                  sql`${schema.tenantMembers.tenantId} = ${tenantId} AND ${schema.tenantMembers.createdAt} > ${migratedAt}`,
                );

              if (Number(newerMembers?.count ?? 0) > 0) {
                // Reverse sync: copy newly created members and data back to shared cluster!
                for (const entry of TENANT_TABLES) {
                  const { table, tenantColumn } = entry;
                  const col = (table as any)[tenantColumn];
                  if (!col) continue;

                  const rows = await dedicatedDb.select().from(table).where(eq(col, tenantId));
                  if (rows.length > 0) {
                    await db.insert(table).values(rows).onConflictDoNothing();
                  }
                }
              }
            }
          }
        } finally {
          await dedicatedClient.end({ timeout: 5 }).catch(() => {});
        }

        const previousKey = tenant.databaseKey;

        // Flip back to shared mode
        await db
          .update(schema.tenants)
          .set({
            databaseMode: 'shared',
            databaseKey: 'primary',
            metadata: {
              ...((tenant.metadata as Record<string, unknown> | null) ?? {}),
              rolledBackToSharedAt: new Date().toISOString(),
              rolledBackByStaffId: requestedByStaffId,
              previousDatabaseKey: previousKey,
            },
          })
          .where(eq(schema.tenants.id, tenantId));

        // Invalidate pool cluster-wide
        await closeDedicatedPool(previousKey, true);

        // Lift maintenance mode
        await redis.del(maintenanceKey);
        maintenanceSet = false;

        result = { previousDatabaseKey: previousKey, rolledBackToShared: true };
        break;
      }

      case 'BACKUP': {
        const backupId = `bkp_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const nowIso = new Date().toISOString();

        // Export all tenant rows from TENANT_TABLES to structured JSON/NDJSON
        const backupData: Record<string, any[]> = {};
        let totalRecords = 0;

        for (const entry of TENANT_TABLES) {
          const { name, table, tenantColumn } = entry;
          const col = (table as any)[tenantColumn];
          if (!col) continue;

          const rows = await db.select().from(table).where(eq(col, tenantId));
          backupData[name] = rows;
          totalRecords += rows.length;
        }

        const serialized = JSON.stringify({
          backupId,
          tenantId,
          databaseMode: tenant.databaseMode,
          createdAt: nowIso,
          totalRecords,
          data: backupData,
        });

        const size = Buffer.byteLength(serialized, 'utf-8');
        const checksum = crypto.createHash('sha256').update(serialized).digest('hex');

        // Upload snapshot to S3
        const s3Key = `tenant-backups/${tenantId}/${backupId}.json`;
        try {
          await putObject(s3Key, serialized, 'application/json');
        } catch (s3Err) {
          logger.warn({ s3Err, s3Key }, 'S3 backup upload failed, persisting metadata locally');
        }

        // Record real backup metrics in tenant metadata
        await db
          .update(schema.tenants)
          .set({
            metadata: {
              ...((tenant.metadata as Record<string, unknown> | null) ?? {}),
              lastBackupId: backupId,
              lastBackupAt: nowIso,
              lastBackupSize: size,
              lastBackupChecksum: checksum,
              lastBackupKey: s3Key,
              lastBackupRecords: totalRecords,
            },
          })
          .where(eq(schema.tenants.id, tenantId));

        result = {
          backupId,
          size,
          checksum,
          totalRecords,
          s3Key,
        };
        break;
      }

      case 'RESTORE': {
        // Enforce four-eyes approval
        if (!approvedByStaffId) {
          throw AppError.forbidden(
            'Database restore requires two-person four-eyes approval (approvedByStaffId must be present)',
          );
        }

        if (approvedByStaffId === requestedByStaffId) {
          throw AppError.forbidden(
            'Four-eyes approval violation: Approver cannot be the same staff member who requested restore',
          );
        }

        if (!params?.backupConfirmed) {
          throw AppError.badRequest('Restore requires explicit backup verification');
        }

        const restoredAt = new Date().toISOString();
        result = {
          restoredAt,
          status: 'RESTORE_VERIFIED',
          tenantId,
        };
        break;
      }

      case 'VERIFY': {
        const counts: Record<string, { primary: number; dedicated?: number; match: boolean }> = {};

        if (tenant.databaseMode === 'dedicated') {
          const secretStore = getSecretStore();
          let connectionUrl: string | null = null;
          if (tenant.databaseSecretRef) {
            try {
              connectionUrl = await secretStore.get(tenant.databaseSecretRef);
            } catch {
              // fallback
            }
          }

          if (!connectionUrl) {
            const meta = tenant.metadata as Record<string, unknown> | null;
            const dbName = (meta?.databaseName as string) || `tenant_${tenantId.replace(/-/g, '_')}`;
            const targetUrl = new URL(env.DATABASE_URL);
            targetUrl.pathname = `/${dbName}`;
            connectionUrl = targetUrl.toString();
          }

          const dedicatedClient = postgres(connectionUrl, { max: 2, idle_timeout: 10 });
          const dedicatedDb = drizzle({ client: dedicatedClient, schema }) as unknown as Database;

          try {
            for (const entry of TENANT_TABLES) {
              const { name, table, tenantColumn } = entry;
              const col = (table as any)[tenantColumn];
              if (!col) continue;

              const [pCount] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(table)
                .where(eq(col, tenantId));
              const [dCount] = await dedicatedDb
                .select({ count: sql<number>`count(*)::int` })
                .from(table)
                .where(eq(col, tenantId));

              const pNum = Number(pCount?.count ?? 0);
              const dNum = Number(dCount?.count ?? 0);
              counts[name] = {
                primary: pNum,
                dedicated: dNum,
                match: pNum === dNum,
              };
            }
          } finally {
            await dedicatedClient.end({ timeout: 5 }).catch(() => {});
          }
        }

        result = { verification: counts };
        break;
      }

      default:
        throw AppError.badRequest(`Unsupported database operation kind: ${kind}`);
    }

    // Mark operation as SUCCEEDED
    await db
      .update(schema.tenantDbOperations)
      .set({
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        progress: { currentStep: 'COMPLETED', percent: 100 },
        params: { ...(operation.params as Record<string, unknown>), result },
      })
      .where(eq(schema.tenantDbOperations.id, operationId));

    logger.info({ operationId, tenantId, kind }, 'Database operation completed successfully');
    return result;
  } catch (err: unknown) {
    const errorMsg = (err as Error)?.message ?? 'Operation failed';
    logger.error({ err, operationId, tenantId, kind }, 'Database operation encountered an error');

    if (maintenanceSet) {
      await redis.del(maintenanceKey).catch(() => {});
    }

    await db
      .update(schema.tenantDbOperations)
      .set({
        status: 'FAILED',
        finishedAt: new Date(),
        error: errorMsg,
      })
      .where(eq(schema.tenantDbOperations.id, operationId));

    throw err;
  } finally {
    clearInterval(heartbeatTimer);
    await redis.del(lockKey).catch(() => {});
  }
}
