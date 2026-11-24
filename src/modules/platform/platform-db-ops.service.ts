import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { db, type Database } from '@/config/db';
import { env } from '@/config/env';
import { redis } from '@/config/redis';
import * as schema from '@/db/schema/index';
import { checkTenantDbHealth, closeDedicatedPool, getDedicatedPoolStats } from '@/lib/db-manager';
import { AppError } from '@/lib/errors';
import { provisionDedicatedDatabase } from '@/lib/provision-db';
import { getSecretStore } from '@/lib/secrets';
import { dbOpsQueue } from '@/queues/index';

import {
  type ExecuteTenantDatabaseOperationDto,
  type ListTenantDatabasesQueryDto,
  type MigrateTenantDatabaseDto,
} from './platform.dto';
import * as platformRepo from './platform.repository';

export async function migrateTenantToDedicated(
  actorStaffId: string,
  tenantId: string,
  options?: MigrateTenantDatabaseDto,
  requestId?: string,
) {
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  if (!tenant) throw AppError.notFound('Tenant not found');

  if (tenant.databaseMode === 'dedicated') {
    throw AppError.conflict('Tenant is already running on an isolated dedicated database');
  }

  const lockKey = `lock:tenant-db-migration:${tenantId}`;
  const acquired = await redis.set(lockKey, actorStaffId, 'EX', 300, 'NX');
  if (!acquired) {
    throw AppError.conflict(
      'A migration operation is already in progress for this tenant database',
    );
  }

  const maintenanceKey = `tenant:${tenant.id}:maintenance`;
  // Step 0: Put tenant in maintenance mode during data sync (mutations return 503)
  await redis.set(maintenanceKey, '1', 'EX', 1800);

  try {
    const defaultSanitizedId = tenant.id.replace(/-/g, '_');
    const databaseName = options?.customDatabaseName?.trim() || `tenant_${defaultSanitizedId}`;
    const databaseKey = `dedicated-${tenant.id}`;
    const poolLimit = options?.poolLimit ?? 5;
    const connectionUrl = options?.connectionUrl?.trim() || env.DATABASE_URL;

    // Step 1: Provision dedicated PostgreSQL database and apply Drizzle migrations
    const dbResult = await provisionDedicatedDatabase(tenant.id, {
      customDatabaseName: databaseName,
      customDatabaseKey: databaseKey,
      poolLimit,
      connectionUrl,
    });

    // Step 2: Open temporary direct connection to newly provisioned database
    const targetUrl = new URL(connectionUrl);
    targetUrl.pathname = `/${dbResult.databaseName}`;
    const dedicatedClient = postgres(targetUrl.toString(), { max: 2, idle_timeout: 10 });
    const dedicatedDb = drizzle({ client: dedicatedClient, schema }) as unknown as Database;

    const recordsMigrated = {
      members: 0,
      subscriptions: 0,
      invoices: 0,
      files: 0,
      modules: 0,
      branding: 0,
    };

    try {
      // 2a. Replicate tenant record
      await dedicatedDb
        .insert(schema.tenants)
        .values({
          ...tenant,
          databaseMode: 'dedicated',
          databaseKey: dbResult.databaseKey,
        })
        .onConflictDoNothing();

      // 2b. Replicate tenant branding
      const brandings = await db
        .select()
        .from(schema.tenantBrandings)
        .where(eq(schema.tenantBrandings.tenantId, tenant.id));
      if (brandings?.length) {
        await dedicatedDb.insert(schema.tenantBrandings).values(brandings).onConflictDoNothing();
        recordsMigrated.branding = brandings.length;
      }

      // 2c. Replicate tenant members & roles (replicate member user accounts first for FK integrity)
      const members = await db
        .select()
        .from(schema.tenantMembers)
        .where(eq(schema.tenantMembers.tenantId, tenant.id));
      if (members?.length) {
        const userIds = [...new Set(members.map((m) => m.userId))];
        if (userIds.length > 0) {
          const memberUsers = await db
            .select()
            .from(schema.users)
            .where(inArray(schema.users.id, userIds));
          if (memberUsers?.length) {
            await dedicatedDb.insert(schema.users).values(memberUsers).onConflictDoNothing();
          }
        }

        await dedicatedDb.insert(schema.tenantMembers).values(members).onConflictDoNothing();
        recordsMigrated.members = members.length;

        const memberIds = members.map((m) => m.id);
        if (memberIds.length > 0) {
          const memberRoles = await db
            .select()
            .from(schema.tenantMemberRoles)
            .where(inArray(schema.tenantMemberRoles.memberId, memberIds));
          if (memberRoles?.length) {
            await dedicatedDb
              .insert(schema.tenantMemberRoles)
              .values(memberRoles)
              .onConflictDoNothing();
          }
        }
      }

      // 2d. Replicate tenant custom roles
      const customRoles = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.tenantId, tenant.id));
      if (customRoles?.length) {
        await dedicatedDb.insert(schema.roles).values(customRoles).onConflictDoNothing();
      }

      // 2e. Replicate tenant modules
      const modules = await db
        .select()
        .from(schema.tenantModules)
        .where(eq(schema.tenantModules.tenantId, tenant.id));
      if (modules?.length) {
        await dedicatedDb.insert(schema.tenantModules).values(modules).onConflictDoNothing();
        recordsMigrated.modules = modules.length;
      }

      // 2f. Replicate subscriptions and subscription events
      const subs = await db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.tenantId, tenant.id));
      if (subs?.length) {
        await dedicatedDb.insert(schema.subscriptions).values(subs).onConflictDoNothing();
        recordsMigrated.subscriptions = subs.length;

        const subEvents = await db
          .select()
          .from(schema.subscriptionEvents)
          .where(eq(schema.subscriptionEvents.tenantId, tenant.id));
        if (subEvents?.length) {
          await dedicatedDb
            .insert(schema.subscriptionEvents)
            .values(subEvents)
            .onConflictDoNothing();
        }
      }

      // 2g. Replicate invoices (line items are jsonb on the invoice record)
      const invs = await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.tenantId, tenant.id));
      if (invs?.length) {
        await dedicatedDb.insert(schema.invoices).values(invs).onConflictDoNothing();
        recordsMigrated.invoices = invs.length;
      }

      // 2h. Replicate files
      const fileRecords = await db
        .select()
        .from(schema.files)
        .where(eq(schema.files.tenantId, tenant.id));
      if (fileRecords?.length) {
        await dedicatedDb.insert(schema.files).values(fileRecords).onConflictDoNothing();
        recordsMigrated.files = fileRecords.length;
      }

      // 2i. Verify row counts before switchover
      if (recordsMigrated.members > 0) {
        const [cnt] = await dedicatedDb
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.tenantMembers)
          .where(eq(schema.tenantMembers.tenantId, tenant.id));
        if (Number(cnt?.count ?? 0) < recordsMigrated.members) {
          throw AppError.internal(
            'Migration verification failed: member count mismatch in dedicated database',
          );
        }
      }
    } finally {
      await dedicatedClient.end({ timeout: 5 }).catch(() => {});
    }

    // Step 3: Securely store database credentials in SecretStore (never in raw metadata)
    let databaseSecretRef = tenant.databaseSecretRef;
    if (options?.connectionUrl) {
      const secretStore = getSecretStore();
      databaseSecretRef = await secretStore.put(
        'db-connection-url',
        options.connectionUrl,
        tenant.id,
      );
    }

    const currentMetadata = { ...(tenant.metadata as Record<string, unknown> | null) };
    delete (currentMetadata as Record<string, unknown>).connectionUrl;

    const [updatedTenant] = await db
      .update(schema.tenants)
      .set({
        databaseMode: 'dedicated',
        databaseKey: dbResult.databaseKey,
        databaseSecretRef,
        metadata: {
          ...currentMetadata,
          databaseName: dbResult.databaseName,
          poolLimit: dbResult.poolLimit,
          schemaVersion: dbResult.schemaVersion,
          migratedToDedicatedAt: new Date().toISOString(),
          migratedByStaffId: actorStaffId,
        },
      })
      .where(eq(schema.tenants.id, tenant.id))
      .returning();

    // Invalidate any active pool in cache
    await closeDedicatedPool(dbResult.databaseKey);

    // Step 4: Lift maintenance mode
    await redis.del(maintenanceKey).catch(() => {});

    // Step 5: Record immutable platform audit entry
    await platformRepo.logPlatformAction({
      actorStaffId,
      action: 'tenant.database_migrated',
      targetType: 'tenant',
      targetId: tenant.id,
      tenantId: tenant.id,
      metadata: {
        previousMode: 'shared',
        newMode: 'dedicated',
        databaseName: dbResult.databaseName,
        databaseKey: dbResult.databaseKey,
        recordsMigrated,
      },
      requestId,
    });

    return {
      tenant: updatedTenant,
      databaseName: dbResult.databaseName,
      databaseKey: dbResult.databaseKey,
      recordsMigrated,
    };
  } finally {
    await redis.del(maintenanceKey).catch(() => {});
    await redis.del(lockKey).catch(() => {});
  }
}

export async function rollbackTenantToShared(
  actorStaffId: string,
  tenantId: string,
  requestId?: string,
) {
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  if (!tenant) throw AppError.notFound('Tenant not found');

  if (tenant.databaseMode !== 'dedicated') {
    throw AppError.badRequest('Tenant is not currently running on a dedicated database');
  }

  const previousKey = tenant.databaseKey;
  const [updatedTenant] = await db
    .update(schema.tenants)
    .set({
      databaseMode: 'shared',
      databaseKey: 'primary',
      metadata: {
        ...(tenant.metadata as Record<string, unknown> | null),
        rolledBackToSharedAt: new Date().toISOString(),
        rolledBackByStaffId: actorStaffId,
        previousDatabaseKey: previousKey,
      },
    })
    .where(eq(schema.tenants.id, tenant.id))
    .returning();

  // Close and evict dedicated pool
  await closeDedicatedPool(previousKey);

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.database_rollback_shared',
    targetType: 'tenant',
    targetId: tenant.id,
    tenantId: tenant.id,
    metadata: {
      previousMode: 'dedicated',
      newMode: 'shared',
      previousDatabaseKey: previousKey,
    },
    requestId,
  });

  return {
    tenant: updatedTenant,
    previousDatabaseKey: previousKey,
    rolledBackAt: new Date().toISOString(),
  };
}

export async function getTenantDatabaseHealth(tenantId: string) {
  const [tenant] = await db
    .select({
      id: schema.tenants.id,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  if (!tenant) throw AppError.notFound('Tenant not found');

  return checkTenantDbHealth(tenantId);
}

export function getDatabasePoolStats() {
  return getDedicatedPoolStats();
}

export async function listTenantDatabases(filters?: ListTenantDatabasesQueryDto) {
  return platformRepo.listTenantDatabasesPaginated(filters);
}

export async function executeTenantDatabaseOperation(
  actorStaffId: string,
  tenantId: string,
  data: ExecuteTenantDatabaseOperationDto,
  requestId?: string,
) {
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  if (!tenant || tenant.deletedAt) {
    throw AppError.notFound('Tenant workspace not found');
  }

  const action = data.action;

  if (action === 'HEALTH_CHECK') {
    const health = await checkTenantDbHealth(tenantId);
    const lastHealthCheckStatus = health.healthy ? 'HEALTHY' : 'UNHEALTHY';
    const lastHealthLatencyMs = health.latencyMs;
    const lastHealthCheckAt = new Date().toISOString();

    await db
      .update(schema.tenants)
      .set({
        metadata: {
          ...(tenant.metadata as Record<string, unknown> | null),
          lastHealthCheckStatus,
          lastHealthLatencyMs,
          lastHealthCheckAt,
        },
      })
      .where(eq(schema.tenants.id, tenantId));

    await platformRepo.logPlatformAction({
      actorStaffId,
      action: 'tenant.database_health_check',
      targetType: 'tenant',
      targetId: tenantId,
      tenantId,
      metadata: {
        reason: data.reason,
        healthy: health.healthy,
        latencyMs: health.latencyMs,
        databaseMode: health.databaseMode,
        databaseKey: health.databaseKey,
      },
      requestId,
    });

    return {
      action: 'HEALTH_CHECK',
      tenantId,
      healthy: health.healthy,
      latencyMs: health.latencyMs,
      databaseMode: health.databaseMode,
      databaseKey: health.databaseKey,
      databaseName: health.databaseName,
      error: health.error,
    };
  }

  // 2. Map high-level action to async background job kind
  type DbOpKind =
    | 'PROVISION'
    | 'MIGRATE_SCHEMA'
    | 'SWITCH_TO_DEDICATED'
    | 'ROLLBACK_TO_SHARED'
    | 'BACKUP'
    | 'RESTORE'
    | 'VERIFY';

  let kind: DbOpKind;
  if (action === 'MIGRATE') {
    kind = tenant.databaseMode === 'shared' ? 'SWITCH_TO_DEDICATED' : 'MIGRATE_SCHEMA';
  } else if (action === 'PROVISION' || action === 'RETRY_PROVISIONING') {
    kind = tenant.databaseMode === 'shared' ? 'SWITCH_TO_DEDICATED' : 'PROVISION';
  } else if (action === 'ROLLBACK') {
    kind = 'ROLLBACK_TO_SHARED';
  } else if (action === 'BACKUP') {
    kind = 'BACKUP';
  } else if (action === 'RESTORE') {
    kind = 'RESTORE';
  } else if (action === 'VERIFY') {
    kind = 'VERIFY';
  } else {
    throw AppError.badRequest(`Unsupported database operation action: ${action}`);
  }

  // 3. For rollback or restore without backup confirmation, fail fast
  if ((action === 'ROLLBACK' || action === 'RESTORE') && !data.backupConfirmed) {
    throw AppError.badRequest(`${action} requires explicit backup confirmation`);
  }

  // 4. Create persistent audit tracking record in primary database
  const opRecord = await platformRepo.createTenantDbOperation({
    tenantId,
    kind,
    status: 'QUEUED',
    requestedByStaffId: actorStaffId,
    approvedByStaffId: data.approvedByStaffId,
    reason: data.reason,
    params: {
      action,
      customDatabaseName: data.customDatabaseName,
      poolLimit: data.poolLimit,
      connectionUrl: data.connectionUrl,
      targetVersion: data.targetVersion,
      maintenanceWindow: data.maintenanceWindow,
      backupConfirmed: data.backupConfirmed,
      discardDedicatedData: data.discardDedicatedData,
    },
    progress: { currentStep: 'QUEUED', percent: 0 },
  });

  if (!opRecord) {
    throw AppError.internal('Failed to record database operation in platform registry');
  }

  // 5. Enqueue background BullMQ job
  await dbOpsQueue.add(
    `db-op:${kind}:${tenantId}`,
    {
      operationId: opRecord.id,
      tenantId,
      kind,
      requestedByStaffId: actorStaffId,
      approvedByStaffId: data.approvedByStaffId,
      reason: data.reason,
      params: {
        customDatabaseName: data.customDatabaseName,
        poolLimit: data.poolLimit,
        connectionUrl: data.connectionUrl,
        targetVersion: data.targetVersion,
        maintenanceWindow: data.maintenanceWindow,
        backupConfirmed: data.backupConfirmed,
        discardDedicatedData: data.discardDedicatedData,
      },
      requestId,
    },
    {
      jobId: `db-op-${opRecord.id}`,
    },
  );

  // 6. Record platform audit trail
  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.database_operation_enqueued',
    targetType: 'database_operation',
    targetId: opRecord.id,
    tenantId,
    metadata: {
      action,
      kind,
      reason: data.reason,
      operationId: opRecord.id,
      databaseMode: tenant.databaseMode,
    },
    requestId,
  });

  return {
    action,
    operationId: opRecord.id,
    kind,
    status: 'QUEUED',
    tenantId,
    requestedAt: opRecord.createdAt,
    message: `Database operation ${action} (${kind}) enqueued successfully. Monitor progress at /api/v1/platform/database-operations/history/${opRecord.id}`,
  };
}

export async function getTenantDbOperation(operationId: string) {
  const op = await platformRepo.getTenantDbOperationById(operationId);
  if (!op) throw AppError.notFound('Database operation record not found');
  return op;
}

export async function listTenantDbOperations(tenantId: string) {
  return platformRepo.listTenantDbOperations(tenantId);
}

export async function approveTenantDbOperation(
  operationId: string,
  approverStaffId: string,
  reason: string,
  requestId?: string,
) {
  const op = await platformRepo.getTenantDbOperationById(operationId);
  if (!op) throw AppError.notFound('Database operation not found');

  if (op.requestedByStaffId === approverStaffId) {
    throw AppError.forbidden(
      'Four-eyes approval violation: Approver cannot be the same staff member who requested the operation',
    );
  }

  if (op.approvedByStaffId) {
    throw AppError.conflict('Operation has already been approved');
  }

  if (op.status !== 'QUEUED') {
    throw AppError.conflict(`Cannot approve operation with status ${op.status}`);
  }

  const updated = await platformRepo.updateTenantDbOperation(operationId, {
    approvedByStaffId: approverStaffId,
  });

  await platformRepo.logPlatformAction({
    actorStaffId: approverStaffId,
    action: 'tenant.database_operation_approved',
    targetType: 'database_operation',
    targetId: operationId,
    tenantId: op.tenantId,
    metadata: { reason, operationKind: op.kind },
    requestId,
  });

  return updated;
}

export async function cancelTenantDbOperation(
  operationId: string,
  staffId: string,
  requestId?: string,
) {
  const op = await platformRepo.getTenantDbOperationById(operationId);
  if (!op) throw AppError.notFound('Database operation not found');

  if (op.status !== 'QUEUED') {
    throw AppError.conflict(`Cannot cancel operation with status ${op.status}`);
  }

  const updated = await platformRepo.updateTenantDbOperation(operationId, {
    status: 'CANCELLED',
    finishedAt: new Date(),
    error: 'Operation cancelled by platform staff operator',
  });

  await platformRepo.logPlatformAction({
    actorStaffId: staffId,
    action: 'tenant.database_operation_cancelled',
    targetType: 'database_operation',
    targetId: operationId,
    tenantId: op.tenantId,
    requestId,
  });

  return updated;
}
