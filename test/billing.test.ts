import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db';
import { closeRedisClients } from '../src/config/redis';
import { AppError } from '../src/lib/errors';
import * as billingDto from '../src/modules/billing/billing.dto';
import { DEFAULT_PLANS } from '../src/modules/billing/plans.defaults';
import { manualBillingProvider } from '../src/modules/billing/provider';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('DEFAULT_PLANS contains FREE, PRO, ENTERPRISE with correct limits', () => {
  const free = DEFAULT_PLANS.find((p) => p.key === 'FREE');
  const pro = DEFAULT_PLANS.find((p) => p.key === 'PRO');
  const ent = DEFAULT_PLANS.find((p) => p.key === 'ENTERPRISE');

  assert.ok(free);
  assert.ok(pro);
  assert.ok(ent);

  assert.equal(free.limits.maxMembers, 5);
  assert.equal(free.limits.maxStorageBytes, 1 * 1024 * 1024 * 1024);
  assert.equal(free.limits.maxCustomRoles, 2);

  assert.equal(pro.limits.maxMembers, 25);
  assert.equal(pro.limits.maxStorageBytes, 50 * 1024 * 1024 * 1024);
  assert.equal(pro.limits.maxCustomRoles, 20);

  assert.equal(ent.limits.maxMembers, null);
  assert.equal(ent.limits.maxStorageBytes, null);
  assert.equal(ent.limits.maxCustomRoles, null);
});

test('planLimitsDto validates null (unlimited) and positive integers', () => {
  const valid = billingDto.planLimitsDto.safeParse({
    maxMembers: 10,
    maxStorageBytes: 1073741824,
    maxCustomRoles: 5,
  });
  assert.ok(valid.success);

  const unlimited = billingDto.planLimitsDto.safeParse({
    maxMembers: null,
    maxStorageBytes: null,
    maxCustomRoles: null,
  });
  assert.ok(unlimited.success);

  const invalid = billingDto.planLimitsDto.safeParse({
    maxMembers: -1,
  });
  assert.equal(invalid.success, false);
});

test('manualBillingProvider rejects unsupported operations with AppError', async () => {
  await assert.rejects(
    async () => {
      await manualBillingProvider.createCheckout({} as any, 'PRO');
    },
    (err: any) => err instanceof AppError && err.status === 400,
  );

  await assert.rejects(
    async () => {
      await manualBillingProvider.parseWebhook({} as any);
    },
    (err: any) => err instanceof AppError && err.status === 400,
  );
});

test('planIdParamDto rejects non-UUID identifiers like "platform"', () => {
  const result = billingDto.planIdParamDto.safeParse({ id: 'platform' });
  assert.equal(result.success, false);
});
