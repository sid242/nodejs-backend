import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../src/lib/errors';
import { errorHandler } from '../src/middleware/error';
import { getLogCustomProps } from '../src/middleware/http-logger';
import {
  captureException,
  captureJobException,
  initSentry,
  isSentryEnabled,
  scrubValue,
} from '../src/observability/sentry';

test('scrubValue recursively redacts passwords, tokens, secrets, keys, and cards', () => {
  const payload = {
    user: 'alice',
    password: 'superSecretPassword123',
    nested: {
      passwordHash: '$2a$12$somehashhere',
      refreshToken: 'rf-token-xyz',
      accessToken: 'at-token-abc',
      supportToken: 'st-token-123',
      apiKey: 'sk_live_123456789',
      creditCard: '4111222233334444',
      cvv: '123',
    },
    items: [
      { id: 1, secret: 'jwt-secret' },
      { id: 2, safeField: 'visible' },
    ],
  };

  const scrubbed = scrubValue(payload) as any;

  assert.equal(scrubbed.user, 'alice');
  assert.equal(scrubbed.password, '[REDACTED]');
  assert.equal(scrubbed.nested.passwordHash, '[REDACTED]');
  assert.equal(scrubbed.nested.refreshToken, '[REDACTED]');
  assert.equal(scrubbed.nested.accessToken, '[REDACTED]');
  assert.equal(scrubbed.nested.supportToken, '[REDACTED]');
  assert.equal(scrubbed.nested.apiKey, '[REDACTED]');
  assert.equal(scrubbed.nested.creditCard, '[REDACTED]');
  assert.equal(scrubbed.nested.cvv, '[REDACTED]');
  assert.equal(scrubbed.items[0].secret, '[REDACTED]');
  assert.equal(scrubbed.items[1].safeField, 'visible');
});

test('Sentry fails gracefully (no-op) when SENTRY_DSN is not configured', () => {
  initSentry();
  // With no DSN set in env, it should not be initialized
  assert.equal(isSentryEnabled(), false);

  // Calling capture methods should be completely safe and not throw
  assert.doesNotThrow(() => {
    captureException(new Error('Sample test error'), {
      tags: { testTag: 'true' },
    });
    captureJobException(new Error('Sample job error'), {
      id: 'job-123',
      name: 'send-email',
      data: { tenantId: 'tenant-abc' },
    });
  });
});

test('errorHandler returns standardized error envelope without leaking internal details', () => {
  let statusCode = 0;
  let responseBody: any = null;

  const mockRes: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: any) {
      responseBody = body;
      return this;
    },
  };

  const mockReq: any = {
    id: 'req-trace-uuid-123',
    method: 'GET',
    originalUrl: '/api/v1/test',
    log: {
      error: () => {},
      warn: () => {},
    },
  };

  // 1. Handled AppError (400 Bad Request)
  errorHandler(AppError.badRequest('Invalid parameter', { field: 'name' }), mockReq, mockRes, () => {});
  assert.equal(statusCode, 400);
  assert.equal(responseBody.error.code, 'BAD_REQUEST');
  assert.equal(responseBody.error.message, 'Invalid parameter');
  assert.deepEqual(responseBody.error.details, { field: 'name' });
  assert.equal(responseBody.requestId, 'req-trace-uuid-123');

  // 2. Unhandled 500 error: details should NOT leak internal stack or db credentials
  const unhandledErr = new Error('Database password was wrong while connecting');
  errorHandler(unhandledErr, mockReq, mockRes, () => {});
  assert.equal(statusCode, 500);
  assert.equal(responseBody.error.code, 'INTERNAL_ERROR');
  assert.equal(responseBody.error.message, 'Something went wrong');
  assert.equal(responseBody.error.details, undefined);
  assert.equal(responseBody.requestId, 'req-trace-uuid-123');
});

test('httpLogger customProps populates correlation context (tenantId, staffId, isSupportSession)', () => {
  const mockReq: any = {
    user: { id: 'usr_123' },
    tenant: { id: 'tnt_abc', slug: 'cyberdyne' },
    staff: { id: 'stf_xyz' },
    isSupportSession: true,
  };

  const props = getLogCustomProps(mockReq);
  assert.equal(props.userId, 'usr_123');
  assert.equal(props.tenantId, 'tnt_abc');
  assert.equal(props.staffId, 'stf_xyz');
  assert.equal(props.isSupportSession, true);
});
