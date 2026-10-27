---
name: testing-workflow
description: >-
  Use this skill when writing, executing, and debugging tests in this project.
  Covers the tsx test runner (`tsx --test`), assertion libraries, mocking, and API testing.
---

# Testing Workflow Runbook

This project uses **tsx** with Node's native test runner (`tsx --test`) and strict assertions (`node:assert/strict`).

---

## 1. Running Tests

- Run all tests:
  ```bash
  npm test
  ```
- Run a specific test file:
  ```bash
  npx tsx --test test/utils.test.ts
  ```
- Run tests matching a name pattern:
  ```bash
  npx tsx --test --test-name-pattern="safeFilename"
  ```
- Run tests in watch mode:
  ```bash
  npx tsx --test --watch
  ```

---

## 2. Writing Unit Tests

Create test files inside the `test/` directory using the `*.test.ts` naming convention:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/lib/errors';
import { AppResponse } from '@/lib/responses';

test('AppResponse returns expected 200 payload structure', () => {
  const res = AppResponse.ok({ count: 5 }, 'Success');
  const json = res.toJSON('req-123');

  assert.equal(res.status, 200);
  assert.equal(json.success, true);
  assert.equal(json.message, 'Success');
  assert.deepEqual(json.data, { count: 5 });
  assert.equal(json.requestId, 'req-123');
});

test('AppError creates 404 not found error', () => {
  const err = AppError.notFound('Resource missing');
  assert.equal(err.status, 404);
  assert.equal(err.code, 'NOT_FOUND');
  assert.equal(err.message, 'Resource missing');
});
```

---

## 3. Mocking & Async Testing

Node's `node:test` module includes built-in mocking utilities:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';

test('mocking an asynchronous service dependency', async (t) => {
  const mockFetcher = t.mock.fn(async (id: string) => ({ id, name: 'Test' }));

  const result = await mockFetcher('123');
  assert.equal(result.name, 'Test');
  assert.equal(mockFetcher.mock.callCount(), 1);
});
```
