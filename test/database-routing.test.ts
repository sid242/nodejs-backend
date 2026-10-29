import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';

import { closeDb, db as primaryDb } from '../src/config/db';
import { env } from '../src/config/env';
import { closeRedisClients } from '../src/config/redis';
import {
  platformAuditLogs,
  platformRoles,
  platformStaff,
  tenantBrandings,
  tenantMembers,
  tenants,
  users,
} from '../src/db/schema/index';
import {
  checkTenantDbHealth,
  closeDedicatedPool,
  drainDedicatedPools,
  getDedicatedPoolStats,
  getTenantDb,
  resetMaxDedicatedPoolsForTesting,
  setMaxDedicatedPoolsForTesting,
} from '../src/lib/db-manager';
import * as platformService from '../src/modules/platform/platform.service';
import { processFile } from '../src/queues/workers/file.worker';

let testStaffId: string;
let testUserId: string;

before(async () => {
  // Ensure a test platform staff exists for audit logs
  const [role] = await primaryDb
    .insert(platformRoles)
    .values({
      key: `TEST_SUPER_ADMIN_${randomUUID().slice(0, 8)}`,
      name: 'Test Super Admin',
      description: 'Role for database routing tests',
      isSystem: false,
    })
    .returning();
  assert.ok(role);

  const [staff] = await primaryDb
    .insert(platformStaff)
    .values({
      email: `db-staff-${randomUUID().slice(0, 8)}@platform.local`,
      displayName: 'DB Staff Tester',
      passwordHash: '$2a$12$dummyhashfordbtesting',
      roleId: role.id,
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(staff);
  testStaffId = staff.id;

  const [user] = await primaryDb
    .insert(users)
    .values({
      email: `db-user-${randomUUID().slice(0, 8)}@example.com`,
      name: 'DB Test User',
      passwordHash: '$2a$12$dummyhashfordbtesting',
    })
    .returning();
  assert.ok(user);
  testUserId = user.id;
});

after(async () => {
  resetMaxDedicatedPoolsForTesting();
  await drainDedicatedPools();
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('getTenantDb: routes undefined or standard tenants to primaryDb', async () => {
  const defaultDb = await getTenantDb();
  assert.equal(defaultDb, primaryDb);

  const sharedContextDb = await getTenantDb({
    id: randomUUID(),
    databaseMode: 'shared',
    databaseKey: 'primary',
  });
  assert.equal(sharedContextDb, primaryDb);

  const nonExistentIdDb = await getTenantDb(randomUUID());
  assert.equal(nonExistentIdDb, primaryDb);
});

test('getTenantDb: resolves shared tenant by tenantId string', async () => {
  const [tenant] = await primaryDb
    .insert(tenants)
    .values({
      name: 'Shared Routing Org',
      slug: `shared-org-${randomUUID().slice(0, 8)}`,
      databaseMode: 'shared',
      databaseKey: 'primary',
    })
    .returning();
  assert.ok(tenant);

  const resolvedDb = await getTenantDb(tenant.id);
  assert.equal(resolvedDb, primaryDb);
});

test('getTenantDb: initializes, caches, and inspects dedicated connection pool', async () => {
  const dedicatedTenantId = randomUUID();
  const poolKey = `dedicated-test-${dedicatedTenantId.slice(0, 8)}`;

  // Use primary database name as target so connectivity succeeds in test environment
  const dedicatedContext = {
    id: dedicatedTenantId,
    databaseMode: 'dedicated',
    databaseKey: poolKey,
    metadata: {
      databaseName: new URL(env.DATABASE_URL).pathname.replace('/', '') || 'postgres',
    },
  };

  const db1 = await getTenantDb(dedicatedContext);
  assert.notEqual(db1, primaryDb, 'Dedicated database instance must not be primaryDb');

  // Second call must return the cached instance
  const db2 = await getTenantDb(dedicatedContext);
  assert.equal(db1, db2, 'Subsequent call must return cached pool instance');

  // Verify pool stats reflect active dedicated pool
  const stats = getDedicatedPoolStats();
  assert.ok(stats.activePools >= 1);
  const found = stats.pools.find((p) => p.key === poolKey);
  assert.ok(found, 'Pool key must be listed in active pool stats');

  // Close specific pool
  const closed = await closeDedicatedPool(poolKey);
  assert.equal(closed, true);

  const statsAfter = getDedicatedPoolStats();
  assert.ok(!statsAfter.pools.some((p) => p.key === poolKey));
});

test('getTenantDb: enforces bounded pool cache and LRU eviction', async () => {
  setMaxDedicatedPoolsForTesting(2);

  const primaryDbName = new URL(env.DATABASE_URL).pathname.replace('/', '') || 'postgres';

  const t1 = {
    id: randomUUID(),
    databaseMode: 'dedicated',
    databaseKey: `pool-lru-1-${randomUUID().slice(0, 4)}`,
    metadata: { databaseName: primaryDbName },
  };
  const t2 = {
    id: randomUUID(),
    databaseMode: 'dedicated',
    databaseKey: `pool-lru-2-${randomUUID().slice(0, 4)}`,
    metadata: { databaseName: primaryDbName },
  };
  const t3 = {
    id: randomUUID(),
    databaseMode: 'dedicated',
    databaseKey: `pool-lru-3-${randomUUID().slice(0, 4)}`,
    metadata: { databaseName: primaryDbName },
  };

  await getTenantDb(t1);
  // Small delay to ensure timestamp progression
  await new Promise((resolve) => setTimeout(resolve, 10));
  await getTenantDb(t2);

  let stats = getDedicatedPoolStats();
  assert.equal(stats.activePools, 2);

  // Inserting 3rd pool must evict oldest (t1)
  await new Promise((resolve) => setTimeout(resolve, 10));
  await getTenantDb(t3);

  stats = getDedicatedPoolStats();
  assert.equal(stats.activePools, 2);
  const keys = stats.pools.map((p) => p.key);
  assert.ok(!keys.includes(t1.databaseKey), 'Oldest pool t1 must have been evicted');
  assert.ok(keys.includes(t2.databaseKey), 'Pool t2 must still be in cache');
  assert.ok(keys.includes(t3.databaseKey), 'Pool t3 must be present in cache');

  resetMaxDedicatedPoolsForTesting();
});

test('checkTenantDbHealth: executes connectivity ping and latency check', async () => {
  const [tenant] = await primaryDb
    .insert(tenants)
    .values({
      name: 'Health Check Org',
      slug: `health-org-${randomUUID().slice(0, 8)}`,
      databaseMode: 'shared',
      databaseKey: 'primary',
    })
    .returning();
  assert.ok(tenant);

  const health = await checkTenantDbHealth(tenant.id);
  assert.equal(health.healthy, true);
  assert.equal(health.databaseMode, 'shared');
  assert.equal(health.databaseKey, 'primary');
  assert.ok(typeof health.latencyMs === 'number' && health.latencyMs >= 0);
});

test('tenant migration lifecycle: migrate to dedicated and rollback to shared', async () => {
  const uniqueSuffix = randomUUID().replace(/-/g, '_').slice(0, 8);
  const dedicatedDbName = `tenant_test_${uniqueSuffix}`;

  // 1. Create a shared tenant with member and branding records
  const [tenant] = await primaryDb
    .insert(tenants)
    .values({
      name: `Migration Source Org ${uniqueSuffix}`,
      slug: `mig-org-${uniqueSuffix}`,
      databaseMode: 'shared',
      databaseKey: 'primary',
      plan: 'FREE',
    })
    .returning();
  assert.ok(tenant);

  await primaryDb.insert(tenantMembers).values({
    tenantId: tenant.id,
    userId: testUserId,
    status: 'ACTIVE',
  });

  await primaryDb.insert(tenantBrandings).values({
    tenantId: tenant.id,
    companyName: 'Source Branding',
    primaryColor: '#0066CC',
  });

  // 2. Execute migration to dedicated database
  const migrationResult = await platformService.migrateTenantToDedicated(
    testStaffId,
    tenant.id,
    {
      customDatabaseName: dedicatedDbName,
      poolLimit: 5,
    },
    'req-mig-test-1',
  );

  assert.ok(migrationResult.tenant);
  assert.equal(migrationResult.tenant.databaseMode, 'dedicated');
  assert.equal(migrationResult.databaseName, dedicatedDbName);
  assert.ok(migrationResult.recordsMigrated.members >= 1);
  assert.ok(migrationResult.recordsMigrated.branding >= 1);

  // Verify tenant registry in primaryDb is updated
  const [updatedTenant] = await primaryDb
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenant.id));
  assert.ok(updatedTenant);
  assert.equal(updatedTenant.databaseMode, 'dedicated');
  assert.equal(updatedTenant.databaseKey, `dedicated-${tenant.id}`);

  // Verify health check succeeds on dedicated database
  const dedicatedHealth = await platformService.getTenantDatabaseHealth(tenant.id);
  assert.equal(dedicatedHealth.healthy, true);
  assert.equal(dedicatedHealth.databaseMode, 'dedicated');

  // Verify platform audit log recorded the migration
  const [auditLog] = await primaryDb
    .select()
    .from(platformAuditLogs)
    .where(eq(platformAuditLogs.targetId, tenant.id))
    .orderBy(platformAuditLogs.createdAt);
  assert.ok(auditLog);
  assert.equal(auditLog.action, 'tenant.database_migrated');

  // 3. Rollback tenant to shared database
  const rollbackResult = await platformService.rollbackTenantToShared(
    testStaffId,
    tenant.id,
    'req-rollback-test-1',
  );

  assert.ok(rollbackResult.tenant);
  assert.equal(rollbackResult.tenant.databaseMode, 'shared');
  assert.equal(rollbackResult.tenant.databaseKey, 'primary');

  // Verify routing returns primaryDb after rollback
  const dbAfterRollback = await getTenantDb(tenant.id);
  assert.equal(dbAfterRollback, primaryDb);
});

test('processFile background worker resolves tenant database routing', async () => {
  // Verifies processFile correctly handles job data with tenantId
  const jobMock = {
    data: {
      fileId: randomUUID(),
      ownerId: testUserId,
      tenantId: randomUUID(), // non-existent file ID -> skipped
    },
    updateProgress: async () => {},
  } as any;

  const result = await processFile(jobMock);
  assert.deepEqual(result, { skipped: true });
});
