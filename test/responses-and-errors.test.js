import test from 'node:test';
import assert from 'node:assert/strict';
import { AppResponse } from '../src/lib/responses.js';
import { AppError } from '../src/lib/errors.js';

test('AppResponse.ok returns 200 envelope with requestId', () => {
  const response = AppResponse.ok({ id: '123', name: 'Alice' }, 'Fetched profile');
  const json = response.toJSON('req-abc-123');

  assert.equal(response.status, 200);
  assert.equal(json.success, true);
  assert.equal(json.message, 'Fetched profile');
  assert.deepEqual(json.data, { id: '123', name: 'Alice' });
  assert.equal(json.requestId, 'req-abc-123');
});

test('AppResponse.created returns 201 envelope with meta and requestId', () => {
  const response = AppResponse.created({ id: '456' }, 'Created resource', { version: 1 });
  const json = response.toJSON('req-xyz-789');

  assert.equal(response.status, 201);
  assert.equal(json.success, true);
  assert.equal(json.message, 'Created resource');
  assert.deepEqual(json.data, { id: '456' });
  assert.deepEqual(json.meta, { version: 1 });
  assert.equal(json.requestId, 'req-xyz-789');
});

test('AppError static constructors produce correct status codes and codes', () => {
  const badReq = AppError.badRequest('Invalid fields', { field: 'name' });
  assert.equal(badReq.status, 400);
  assert.equal(badReq.code, 'BAD_REQUEST');
  assert.deepEqual(badReq.details, { field: 'name' });

  const unauthorized = AppError.unauthorized('Token expired');
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.code, 'UNAUTHORIZED');

  const forbidden = AppError.forbidden();
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.code, 'FORBIDDEN');

  const notFound = AppError.notFound();
  assert.equal(notFound.status, 404);
  assert.equal(notFound.code, 'NOT_FOUND');

  const conflict = AppError.conflict('Email taken');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, 'CONFLICT');
});
