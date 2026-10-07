---
name: create-module
description: >-
  Use this skill when the user wants to add a new API resource, domain, or feature module to the Express backend.
  It provides a complete step-by-step checklist for scaffolding routes, service layer, Drizzle schemas, Zod validation, and tests.
---

# Create API Module Runbook

Follow these steps to scaffold a new domain module in `src/modules/<domain>/` adhering to the project's 3-layer architecture.

---

## Step 1: Define Database Schema (if database storage is required)

1. Create or update `src/db/schema/<domain>.js`:
   ```javascript
   import { pgTable, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core';

   export const items = pgTable('Item', {
     id: uuid('id').defaultRandom().primaryKey(),
     userId: uuid('userId').notNull(),
     title: text('title').notNull(),
     status: text('status').notNull().default('ACTIVE'),
     createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
     updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
       .notNull()
       .defaultNow()
       .$onUpdate(() => new Date()),
   });

   export const publicItem = {
     id: items.id,
     userId: items.userId,
     title: items.title,
     status: items.status,
     createdAt: items.createdAt,
   };
   ```

2. Export the schema in `src/db/schema/index.js`:
   ```javascript
   export * from './<domain>.js';
   ```

3. Run migrations:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```

---

## Step 2: Implement the Service Layer

Create `src/modules/<domain>/<domain>.service.js`:
```javascript
import { desc, eq } from 'drizzle-orm';
import { db } from '../../config/db.js';
import { items, publicItem } from '../../db/schema/index.js';
import { cache } from '../../lib/cache.js';
import { AppError } from '../../lib/errors.js';

export async function createItem(userId, data) {
  const [created] = await db
    .insert(items)
    .values({ userId, ...data })
    .returning(publicItem);
  await cache.delPattern(`items:user:${userId}:*`);
  return created;
}

export const getItemById = (id) =>
  cache.wrap(`item:${id}`, 300, async () => {
    const [item] = await db.select(publicItem).from(items).where(eq(items.id, id)).limit(1);
    if (!item) throw AppError.notFound('Item not found');
    return item;
  });

export const listItems = (userId, { page, limit }) =>
  cache.wrap(`items:user:${userId}:${page}:${limit}`, 60, async () => {
    const records = await db
      .select(publicItem)
      .from(items)
      .where(eq(items.userId, userId))
      .orderBy(desc(items.createdAt))
      .offset((page - 1) * limit)
      .limit(limit);
    return { items: records, page, limit };
  });
```

---

## Step 3: Implement the Routes Layer

Create `src/modules/<domain>/<domain>.routes.js`:
```javascript
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { AppResponse } from '../../lib/responses.js';
import * as service from './<domain>.service.js';

const router = Router();
router.use(requireAuth);

const createSchema = {
  body: z.object({
    title: z.string().min(1).max(200),
  }),
};

const listSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
};

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) =>
    AppResponse.created(await service.createItem(req.user.id, req.valid.body), 'Item created').send(res),
  ),
);

router.get(
  '/',
  validate(listSchema),
  asyncHandler(async (req, res) =>
    AppResponse.ok(await service.listItems(req.user.id, req.valid.query)).send(res),
  ),
);

router.get(
  '/:id',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) =>
    AppResponse.ok(await service.getItemById(req.valid.params.id)).send(res),
  ),
);

export default router;
```

---

## Step 4: Register Routes in Main Router

Open `src/routes.js` and register the new module:
```javascript
import itemRoutes from './modules/<domain>/<domain>.routes.js';

router.use('/<domain>', itemRoutes);
```

---

## Step 5: Add Unit Tests

Create `test/<domain>.test.js` and run `npm test`:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

test('sample domain test', () => {
  assert.equal(1 + 1, 2);
});
```
