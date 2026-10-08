---
name: create-module
description: >-
  Use this skill when the user wants to add a new API resource, domain, or feature module to the Express backend.
  It provides a complete step-by-step checklist for scaffolding DTOs, routes, controller, service layer, database repository, Drizzle schemas, Zod validation, and tests.
---

# Create API Module Runbook

Follow these steps to scaffold a new domain module in `src/modules/<domain>/` adhering to the project's **4-layer architecture + DTOs** (`dto` -> `routes` -> `controller` -> `service` -> `repository`).

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

## Step 2: Implement DTOs (Zod Request & Query Schemas)

Create `src/modules/<domain>/<domain>.dto.js`:

```javascript
import { z } from 'zod';

export const createItemDto = z.object({
  title: z.string().min(1).max(200),
});

export const listItemsQueryDto = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const itemIdParamDto = z.object({
  id: z.string().uuid(),
});
```

---

## Step 3: Implement the Repository Layer (Database Queries)

Create `src/modules/<domain>/<domain>.repository.js`:

```javascript
import { desc, eq } from 'drizzle-orm';
import { db } from '../../config/db.js';
import { items, publicItem } from '../../db/schema/index.js';

export async function create(userId, data) {
  const [created] = await db
    .insert(items)
    .values({ userId, ...data })
    .returning(publicItem);
  return created;
}

export async function findById(id) {
  const [item] = await db.select(publicItem).from(items).where(eq(items.id, id)).limit(1);
  return item ?? null;
}

export async function findByUserId(userId, { page, limit }) {
  return db
    .select(publicItem)
    .from(items)
    .where(eq(items.userId, userId))
    .orderBy(desc(items.createdAt))
    .offset((page - 1) * limit)
    .limit(limit);
}
```

---

## Step 4: Implement the Service Layer (Business Logic)

Create `src/modules/<domain>/<domain>.service.js`:

```javascript
import * as itemRepo from './<domain>.repository.js';
import { cache } from '../../lib/cache.js';
import { AppError } from '../../lib/errors.js';

export async function createItem(userId, data) {
  const created = await itemRepo.create(userId, data);
  await cache.delPattern(`items:user:${userId}:*`);
  return created;
}

export const getItemById = (id) =>
  cache.wrap(`item:${id}`, 300, async () => {
    const item = await itemRepo.findById(id);
    if (!item) throw AppError.notFound('Item not found');
    return item;
  });

export const listItems = (userId, { page, limit }) =>
  cache.wrap(`items:user:${userId}:${page}:${limit}`, 60, async () => {
    const records = await itemRepo.findByUserId(userId, { page, limit });
    return { items: records, page, limit };
  });
```

---

## Step 5: Implement the Controller Layer (HTTP Request/Response)

Create `src/modules/<domain>/<domain>.controller.js`:

```javascript
import { asyncHandler } from '../../lib/async-handler.js';
import { AppResponse } from '../../lib/responses.js';
import * as service from './<domain>.service.js';

export const createItem = asyncHandler(async (req, res) => {
  const result = await service.createItem(req.user.id, req.valid.body);
  AppResponse.created(result, 'Item created').send(res);
});

export const listItems = asyncHandler(async (req, res) => {
  const result = await service.listItems(req.user.id, req.valid.query);
  AppResponse.ok(result).send(res);
});

export const getItemById = asyncHandler(async (req, res) => {
  const result = await service.getItemById(req.valid.params.id);
  AppResponse.ok(result).send(res);
});
```

---

## Step 6: Implement the Routes Layer

Create `src/modules/<domain>/<domain>.routes.js`:

```javascript
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { createItemDto, listItemsQueryDto, itemIdParamDto } from './<domain>.dto.js';
import * as controller from './<domain>.controller.js';

const router = Router();
router.use(requireAuth);

router.post('/', validate({ body: createItemDto }), controller.createItem);
router.get('/', validate({ query: listItemsQueryDto }), controller.listItems);
router.get('/:id', validate({ params: itemIdParamDto }), controller.getItemById);

export default router;
```

---

## Step 7: Register Routes in Main Router

Open `src/routes.js` and register the new module:

```javascript
import itemRoutes from './modules/<domain>/<domain>.routes.js';

router.use('/<domain>', itemRoutes);
```

---

## Step 8: Add Unit Tests

Create `test/<domain>.test.js` and run `npm test`.
