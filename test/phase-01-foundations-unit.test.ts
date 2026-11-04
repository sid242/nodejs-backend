import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db';
import { env } from '../src/config/env';
import { closeRedisClients } from '../src/config/redis';
import { outboxEvents } from '../src/db/schema/audit/outbox-events';
import { outboxStatusEnum } from '../src/db/schema/enums';
import { hasValidBffSecret, requireTenant, resolveTenantContext } from '../src/middleware/tenant';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('Phase 01 Unit: hasValidBffSecret validates cryptographic timing-safe BFF header', () => {
  // Valid secret
  const validReq: any = {
    headers: {
      'x-bff-secret': env.BFF_SHARED_SECRET,
    },
  };
  assert.equal(hasValidBffSecret(validReq), true, 'Valid BFF secret header must be accepted');

  // Invalid secret
  const invalidReq: any = {
    headers: {
      'x-bff-secret': 'wrong-secret-token',
    },
  };
  assert.equal(hasValidBffSecret(invalidReq), false, 'Invalid BFF secret header must be rejected');

  // Missing header
  const emptyReq: any = {
    headers: {},
  };
  assert.equal(hasValidBffSecret(emptyReq), false, 'Missing BFF secret header must be rejected');
});

test('Phase 01 Unit: Untrusted x-tenant-id header without x-bff-secret is completely ignored', async () => {
  const req: any = {
    headers: {
      'x-tenant-id': 'untrusted-spoofed-tenant-id',
      // No x-bff-secret
    },
    user: { id: '00000000-0000-0000-0000-000000000001' },
    params: {},
  };

  let nextCalled = false;
  await resolveTenantContext(req, {} as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  // req.tenant should not be resolved to spoofed id
  assert.equal(req.tenant, undefined, 'Untrusted header must not resolve tenant');
});

test('Phase 01 Unit: requireTenant blocks unauthenticated requests with 401', async () => {
  const req: any = {
    headers: {},
    params: {},
    user: undefined,
    staff: undefined,
  };

  let errResult: any = null;
  await requireTenant(req, {} as any, (err?: any) => {
    errResult = err;
  });

  assert.ok(errResult, 'requireTenant must throw error when unauthenticated');
  assert.equal(errResult.status, 401);
});

test('Phase 01 Unit: requireTenant requires valid tenant identifier with 400 TENANT_REQUIRED', async () => {
  const req: any = {
    headers: {},
    params: {},
    user: { id: '00000000-0000-0000-0000-000000000001' },
  };

  let errResult: any = null;
  await requireTenant(req, {} as any, (err?: any) => {
    errResult = err;
  });

  assert.ok(errResult, 'requireTenant must throw TENANT_REQUIRED when tenant identifier cannot be resolved');
  assert.equal(errResult.status, 400);
  assert.equal(errResult.code, 'TENANT_REQUIRED');
});

test('Phase 01 Unit: OutboxEvent schema defines strict transactional event contract', () => {
  assert.ok(outboxEvents, 'outboxEvents table must exist');
  assert.ok(outboxEvents.id, 'outboxEvents.id must exist');
  assert.ok(outboxEvents.tenantId, 'outboxEvents.tenantId must exist');
  assert.ok(outboxEvents.eventType, 'outboxEvents.eventType must exist');
  assert.ok(outboxEvents.payload, 'outboxEvents.payload must exist');
  assert.ok(outboxEvents.status, 'outboxEvents.status must exist');
  assert.ok(outboxEvents.retryCount, 'outboxEvents.retryCount must exist');
  assert.ok(outboxEvents.createdAt, 'outboxEvents.createdAt must exist');

  assert.deepEqual(
    outboxStatusEnum.enumValues,
    ['PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED'],
    'outboxStatusEnum must match transactional outbox states',
  );
});
