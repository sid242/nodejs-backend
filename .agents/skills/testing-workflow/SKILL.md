---
name: testing-workflow
description: >-
  Use this skill when writing, executing, and debugging tests in this project.
  Covers the native Node.js test runner (`node --test`), assertion libraries, mocking, and API testing.
---

# Testing Workflow Runbook

This project uses the native **Node.js Test Runner** (`node:test`) and strict assertions (`node:assert/strict`).

---

## 1. Running Tests

- Run all tests:
  ```bash
  npm test
  ```
- Run a specific test file:
  ```bash
  node --test test/utils.test.js
  ```
- Run tests matching a name pattern:
  ```bash
  node --test --test-name-pattern="safeFilename"
  ```
- Run tests in watch mode:
  ```bash
  node --test --watch
  ```

---

## 2. Writing Unit Tests

Create test files inside the `test/` directory using the `*.test.js` naming convention:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppResponse } from '../src/lib/responses.js';
import { AppError } from '../src/lib/errors.js';

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

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

test('mocking an asynchronous service dependency', async (t) => {
  const mockFetcher = t.mock.fn(async (id) => ({ id, name: 'Test' }));

  const result = await mockFetcher('123');
  assert.equal(result.name, 'Test');
  assert.equal(mockFetcher.mock.callCount(), 1);
});
```
