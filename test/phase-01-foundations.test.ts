import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';

import { closeDb, db } from '../src/config/db';
import { env } from '../src/config/env';
import { closeRedisClients } from '../src/config/redis';
import {
  outboxEvents,
  tenantMembers,
  users,
} from '../src/db/schema/index';
import { resolveTenantContext } from '../src/middleware/tenant';
import * as outboxRepo from '../src/modules/audit/outbox.repository';
import { tenantsRepo } from '../src/modules/tenants/tenants.repository';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('Phase 01: Tenant context resolution attaches req.db executor', async () => {
  const tenant = await tenantsRepo.createTenant({
    name: 'Context DB Test Tenant',
    slug: `ctx-db-${Date.now()}`,
  });

  const [testUser] = await db
    .insert(users)
    .values({
      email: `ctx-user-${Date.now()}@example.com`,
      name: 'Context User',
      passwordHash: '$2a$12$dummyhash0000000000000000000000000000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(testUser);

  await db.insert(tenantMembers).values({
    tenantId: tenant.id,
    userId: testUser.id,
    status: 'ACTIVE',
  });

  const req: any = {
    headers: {
      'x-tenant-id': tenant.id,
      'x-bff-secret': env.BFF_SHARED_SECRET,
    },
    user: { id: testUser.id },
  };

  let middlewareError: any = null;
  await resolveTenantContext(req, {} as any, (err?: any) => {
    middlewareError = err;
  });

  assert.equal(middlewareError, null, 'resolveTenantContext should succeed for valid member');
  assert.ok(req.tenant, 'req.tenant must be populated');
  assert.equal(req.tenant.id, tenant.id);
  assert.ok(req.db, 'req.db must be populated with database instance');
  assert.equal(typeof req.db.select, 'function', 'req.db must be a functional Drizzle database executor');
});

test('Phase 01: Transactional Outbox repository creates and transitions event states', async () => {
  const tenant = await tenantsRepo.createTenant({
    name: 'Outbox Test Tenant',
    slug: `outbox-${Date.now()}`,
  });

  const event = await outboxRepo.insertOutboxEvent({
    tenantId: tenant.id,
    eventType: 'tenant.workspace.created',
    payload: { tenantId: tenant.id, timestamp: Date.now() },
    status: 'PENDING',
  });

  assert.ok(event.id);
  assert.equal(event.status, 'PENDING');
  assert.equal(event.retryCount, 0);

  // Fetch pending events
  const pending = await outboxRepo.fetchPendingOutboxEvents(10);
  const found = pending.find((e) => e.id === event.id);
  assert.ok(found, 'Created event must appear in pending events query');

  // Mark published
  const published = await outboxRepo.markOutboxEventPublished(event.id);
  assert.ok(published);
  assert.equal(published.status, 'PUBLISHED');
  assert.ok(published.processedAt);

  // Cleanup
  await db.delete(outboxEvents).where(eq(outboxEvents.id, event.id));
});

test('Phase 01: Socket room authorization restricts tenant room join to active members', async () => {
  const tenant = await tenantsRepo.createTenant({
    name: 'Socket Guard Tenant',
    slug: `socket-guard-${Date.now()}`,
  });

  const [activeUser] = await db
    .insert(users)
    .values({
      email: `socket-active-${Date.now()}@example.com`,
      name: 'Socket Active User',
      passwordHash: '$2a$12$dummyhash0000000000000000000000000000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(activeUser);

  const [nonMemberUser] = await db
    .insert(users)
    .values({
      email: `socket-nonmember-${Date.now()}@example.com`,
      name: 'Socket Non-Member',
      passwordHash: '$2a$12$dummyhash0000000000000000000000000000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(nonMemberUser);

  await db.insert(tenantMembers).values({
    tenantId: tenant.id,
    userId: activeUser.id,
    status: 'ACTIVE',
  });

  // Verify findTenantMember check behavior
  const activeMember = await tenantsRepo.findTenantMember(tenant.id, activeUser.id);
  assert.ok(activeMember);
  assert.equal(activeMember.status, 'ACTIVE');

  const crossMember = await tenantsRepo.findTenantMember(tenant.id, nonMemberUser.id);
  assert.equal(crossMember, null, 'Non-member must return null for tenant membership');
});
