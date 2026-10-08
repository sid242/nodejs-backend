# API & Coding Conventions

## 1. Module System & Imports

- Target runtime: Node.js >= 20.6 with native ESM (`"type": "module"`).
- Always use standard ES `import` and `export` statements with full `.js` file extensions:
  ```javascript
  import { AppResponse } from '../../lib/responses.js';
  import { AppError } from '../../lib/errors.js';
  ```

## 2. API Response Formatting

All public HTTP API responses must conform to the standard envelopes:

### Success Response:

```json
{
  "success": true,
  "message": "User profile updated",
  "data": { "id": "123", "name": "Alice" },
  "meta": { "page": 1, "limit": 20, "total": 100 },
  "requestId": "req-1234-5678"
}
```

Constructed using `AppResponse`:

```javascript
// Status 200:
AppResponse.ok(data, 'Optional message', meta).send(res);

// Status 201:
AppResponse.created(data, 'Resource created').send(res);
```

### Error Response:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "details": null
  },
  "requestId": "req-1234-5678"
}
```

## 3. Error Handling

- Use `AppError` subclasses from `src/lib/errors.js`:
  ```javascript
  throw AppError.badRequest('Invalid parameters', validationErrors);
  throw AppError.unauthorized('Invalid or missing authentication token');
  throw AppError.forbidden('You do not have permission to access this resource');
  throw AppError.notFound('Item with specified ID does not exist');
  throw AppError.conflict('Email is already in use');
  ```
- All async route handlers must be wrapped with `asyncHandler`:
  ```javascript
  router.get(
    '/profile',
    requireAuth,
    asyncHandler(async (req, res) => {
      const profile = await service.getProfile(req.user.id);
      AppResponse.ok(profile).send(res);
    }),
  );
  ```

## 4. Request Validation

- Validate all incoming `body`, `query`, and `params` with Zod using the `validate()` middleware:
  ```javascript
  import { validate } from '../../middleware/validate.js';
  import { z } from 'zod';

  const updateSchema = {
    body: z.object({
      name: z.string().min(1).max(100),
      age: z.number().int().positive().optional(),
    }),
    params: z.object({
      id: z.string().uuid(),
    }),
  };

  router.patch('/:id', validate(updateSchema), asyncHandler(...));
  ```
- Validated values are placed onto `req.valid` (e.g., `req.valid.body`, `req.valid.query`, `req.valid.params`).

## 5. Logging Standards

- Inside request contexts, always use `req.log` (Pino child logger with `requestId` and route metadata attached):
  ```javascript
  req.log.info({ userId: req.user.id }, 'User updated profile');
  ```
- Never use `console.log()` or `console.error()`. Use `logger` from `src/config/logger.js` outside of request contexts.
