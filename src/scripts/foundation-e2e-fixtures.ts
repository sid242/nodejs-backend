import { eq, sql } from 'drizzle-orm';

import { env } from '@/config/env';

function validateFixtureEnvironment() {
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  const runtime = new URL(env.DATABASE_URL);
  const migration = new URL(env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL);
  const fixtureName = /^\/foundation_e2e_(leads|core)(_[1-9][0-9]*)?$/;

  if (
    env.NODE_ENV !== 'test' ||
    !loopback.includes(runtime.hostname) ||
    !fixtureName.test(runtime.pathname) ||
    runtime.host !== migration.host ||
    runtime.pathname !== migration.pathname
  ) {
    throw new Error('Use a loopback foundation_e2e_leads or foundation_e2e_core test database');
  }

  for (const address of [
    env.REDIS_URL,
    env.CACHE_REDIS_URL,
    env.QUEUE_REDIS_URL,
    env.SOCKET_REDIS_URL,
  ]) {
    if (!loopback.includes(new URL(address).hostname)) {
      throw new Error('Use loopback Redis endpoints for the browser fixtures');
    }
  }
}

validateFixtureEnvironment();

const { closeDb, db } = await import('@/config/db');
const { cacheRedis, closeRedisClients, redis } = await import('@/config/redis');
const { runFleetMigrations } = await import('@/db/migrate-all');
const { seedDemo } = await import('@/db/seed/demo');
const { closeQueues } = await import('@/queues');
const { users, tenants, tenantMembers } = await import('@/db/schema/index');
const { rbacRepo } = await import('@/modules/rbac/rbac.repository');

try {
  const existingTables = await db.execute(sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' LIMIT 1
  `);
  if (existingTables.length > 0) {
    throw new Error(
      'The browser fixture database already has tables. Create a fresh test database.',
    );
  }
  await Promise.all([redis.ping(), cacheRedis.ping()]);
  await runFleetMigrations();
  await seedDemo({ reset: false });
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'owner@acme.com'));
  if (!owner) throw new Error('Missing workspace-switch user fixture');
  for (const slug of ['nexus-global', 'starlight-ventures']) {
    const [workspace] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug));
    if (!workspace) throw new Error('Missing workspace-switch fixtures');
    const viewerRole = (await rbacRepo.findRolesByTenant(workspace.id)).find(
      (role) => role.name.toUpperCase() === 'VIEWER',
    );
    if (!viewerRole) throw new Error('Missing workspace viewer role');
    const [membership] = await db
      .insert(tenantMembers)
      .values({
        userId: owner.id,
        tenantId: workspace.id,
        status: 'ACTIVE',
      })
      .returning({ id: tenantMembers.id });
    if (!membership) throw new Error('Could not create the browser fixture membership');
    await rbacRepo.assignRoleToMember(membership.id, viewerRole.id);
    if (slug === 'starlight-ventures') {
      await db.update(tenants).set({ urlStyle: 'subdomain' }).where(eq(tenants.id, workspace.id));
    }
  }
} finally {
  await Promise.allSettled([closeQueues(), closeRedisClients(), closeDb()]);
}
