import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOpenApiDocument, openApiDocument } from '@/docs/openapi.js';

test('OpenAPI specification generates valid 3.0.3 document', () => {
  const doc = generateOpenApiDocument();

  assert.equal(doc.openapi, '3.0.3');
  assert.equal(doc.info.title, 'Node Scalable Foundation API');
  assert.equal(doc.info.version, '1.0.0');
  assert.ok(doc.paths, 'Expected paths object');
  assert.ok(doc.components, 'Expected components object');
  assert.ok(doc.components?.securitySchemes?.bearerAuth, 'Expected bearerAuth security scheme');
});

test('OpenAPI spec contains all core API endpoints and tags', () => {
  const paths = Object.keys(openApiDocument.paths ?? {});

  // Auth routes
  assert.ok(paths.includes('/api/v1/auth/register'));
  assert.ok(paths.includes('/api/v1/auth/login'));
  assert.ok(paths.includes('/api/v1/auth/refresh'));
  assert.ok(paths.includes('/api/v1/auth/logout'));
  assert.ok(paths.includes('/api/v1/auth/forgot-password'));
  assert.ok(paths.includes('/api/v1/auth/reset-password'));
  assert.ok(paths.includes('/api/v1/auth/verify-email/request'));
  assert.ok(paths.includes('/api/v1/auth/verify-email/confirm'));

  // User routes
  assert.ok(paths.includes('/api/v1/users/me'));
  assert.ok(paths.includes('/api/v1/users'));

  // Files routes
  assert.ok(paths.includes('/api/v1/files'));
  assert.ok(paths.includes('/api/v1/files/upload-url'));
  assert.ok(paths.includes('/api/v1/files/{id}/confirm'));
  assert.ok(paths.includes('/api/v1/files/{id}/download-url'));
  assert.ok(paths.includes('/api/v1/files/{id}'));

  // Health routes
  assert.ok(paths.includes('/health/live'));
  assert.ok(paths.includes('/health/ready'));
});

test('OpenAPI spec registers common schemas and security components', () => {
  const schemas = openApiDocument.components?.schemas ?? {};

  assert.ok(schemas.SuccessEnvelope);
  assert.ok(schemas.ErrorEnvelope);
  assert.ok(schemas.RegisterInput);
  assert.ok(schemas.LoginInput);
  assert.ok(schemas.User);
  assert.ok(schemas.File);
  assert.ok(schemas.FileUploadRequestInput);
});
