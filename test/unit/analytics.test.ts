import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyticsOverviewQueryDto,
  createReportDefinitionDto,
  listActivityQueryDto,
  listUsageQueryDto,
  recordUsageEventDto,
} from '@/modules/analytics/analytics.dto';

test('Analytics DTOs: recordUsageEventDto', () => {
  const valid = recordUsageEventDto.parse({
    meter: 'members.active',
    quantity: 5,
  });
  assert.equal(valid.meter, 'members.active');
  assert.equal(valid.quantity, 5);
  assert.equal(valid.unit, 'count');

  const storage = recordUsageEventDto.parse({
    meter: 'storage.bytes',
    quantity: 1048576,
    unit: 'bytes',
    idempotencyKey: 'upload-uuid-1234',
  });
  assert.equal(storage.meter, 'storage.bytes');
  assert.equal(storage.quantity, 1048576);
  assert.equal(storage.unit, 'bytes');
  assert.equal(storage.idempotencyKey, 'upload-uuid-1234');

  assert.throws(() => {
    recordUsageEventDto.parse({
      meter: 'invalid.meter',
      quantity: 1,
    });
  });
});

test('Analytics DTOs: analyticsOverviewQueryDto', () => {
  const defaultRange = analyticsOverviewQueryDto.parse({});
  assert.equal(defaultRange.range, '30d');

  const customRange = analyticsOverviewQueryDto.parse({ range: '7d' });
  assert.equal(customRange.range, '7d');

  assert.throws(() => {
    analyticsOverviewQueryDto.parse({ range: '1y' });
  });
});

test('Analytics DTOs: listActivityQueryDto', () => {
  const parsed = listActivityQueryDto.parse({
    limit: 15,
    entityType: 'MEMBER',
  });
  assert.equal(parsed.limit, 15);
  assert.equal(parsed.entityType, 'MEMBER');

  const empty = listActivityQueryDto.parse({});
  assert.equal(empty.limit, 20);
});

test('Analytics DTOs: createReportDefinitionDto', () => {
  const valid = createReportDefinitionDto.parse({
    name: 'Quarterly Audit Report',
    type: 'AUDIT',
    format: 'CSV',
    recipients: ['compliance@acme.com'],
  });
  assert.equal(valid.name, 'Quarterly Audit Report');
  assert.equal(valid.type, 'AUDIT');
  assert.equal(valid.format, 'CSV');
  assert.deepEqual(valid.recipients, ['compliance@acme.com']);

  assert.throws(() => {
    createReportDefinitionDto.parse({
      name: '',
      type: 'AUDIT',
    });
  });
});
