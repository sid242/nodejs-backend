import assert from 'node:assert/strict';
import test from 'node:test';

import {
  placeLegalHoldDto,
  recordConsentDto,
  releaseLegalHoldDto,
  requestAccountDeletionDto,
  requestTenantClosureDto,
  requestUserDataExportDto,
} from '@/modules/privacy/privacy.dto';

test('Privacy DTOs: requestUserDataExportDto', () => {
  const valid = requestUserDataExportDto.parse({});
  assert.equal(valid.format, 'json');

  const custom = requestUserDataExportDto.parse({ format: 'csv' });
  assert.equal(custom.format, 'csv');
});

test('Privacy DTOs: requestAccountDeletionDto', () => {
  const valid = requestAccountDeletionDto.parse({
    password: 'Password123!',
    reason: 'Closing personal accounts',
  });
  assert.equal(valid.password, 'Password123!');
  assert.equal(valid.reason, 'Closing personal accounts');

  const empty = requestAccountDeletionDto.parse({});
  assert.equal(empty.password, undefined);
  assert.equal(empty.reason, undefined);
});

test('Privacy DTOs: requestTenantClosureDto', () => {
  const valid = requestTenantClosureDto.parse({
    slugConfirmation: 'acme-realty',
    reason: 'Merging with another entity',
  });
  assert.equal(valid.slugConfirmation, 'acme-realty');

  assert.throws(() => {
    requestTenantClosureDto.parse({ slugConfirmation: '' });
  });
});

test('Privacy DTOs: recordConsentDto', () => {
  const valid = recordConsentDto.parse({
    type: 'TERMS',
    version: '2026.1',
  });
  assert.equal(valid.type, 'TERMS');
  assert.equal(valid.version, '2026.1');

  assert.throws(() => {
    recordConsentDto.parse({ type: 'INVALID', version: '1.0' });
  });

  assert.throws(() => {
    recordConsentDto.parse({ type: 'PRIVACY', version: '' });
  });
});

test('Privacy DTOs: placeLegalHoldDto & releaseLegalHoldDto', () => {
  const validPlace = placeLegalHoldDto.parse({
    reason: 'Ongoing regulatory audit inquiry',
  });
  assert.equal(validPlace.reason, 'Ongoing regulatory audit inquiry');

  assert.throws(() => {
    placeLegalHoldDto.parse({ reason: 'abc' }); // min 5 chars
  });

  const validRelease = releaseLegalHoldDto.parse({
    reason: 'Audit resolved and closed',
  });
  assert.equal(validRelease.reason, 'Audit resolved and closed');
});
