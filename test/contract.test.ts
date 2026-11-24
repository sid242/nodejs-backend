import assert from 'node:assert/strict';
import test from 'node:test';

import { generateOpenApiDocument } from '@/docs/openapi';

test('API contract conforms to OpenAPI 3.0 specification standards', () => {
  const doc = generateOpenApiDocument();

  assert.equal(doc.openapi, '3.0.3');
  assert.ok(doc.paths, 'OpenAPI paths object must be defined');

  // Verify core domain contracts match expected methods
  const authLogin = doc.paths['/api/v1/auth/login']?.post;
  assert.ok(authLogin, 'POST /api/v1/auth/login must be registered');

  const filesConfirm = doc.paths['/api/v1/files/{id}/confirm']?.post;
  assert.ok(filesConfirm, 'POST /api/v1/files/{id}/confirm must be registered');

  const healthLive = doc.paths['/health/live']?.get;
  assert.ok(healthLive, 'GET /health/live must be registered');

  const tenantMembers = doc.paths['/api/v1/tenants/{tenantId}/members']?.get;
  assert.ok(tenantMembers, 'GET /api/v1/tenants/{tenantId}/members must be registered');
});
