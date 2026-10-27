---
name: create-module
description: >-
  Use this skill when the user wants to add a new API resource, domain, or feature module to the Express backend.
  It provides a complete step-by-step checklist for scaffolding DTOs, routes, controller, service layer, database repository, Drizzle schemas, Zod validation, and tests.
---

# Create API Module Runbook

Follow these steps to scaffold a new domain module in `src/modules/<domain>/` adhering to the project's **4-layer architecture + DTOs** (`dto` -> `routes` -> `controller` -> `service` -> `repository`) with strict TypeScript and clean extensionless imports.

---

## Step 1: Define Database Schema (if database storage is required)

1. Create or update `src/db/schema/<domain>.ts`:

   ```typescript
   import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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

   export type Item = typeof items.$inferSelect;
   export type PublicItem = typeof publicItem;
   ```

2. Export the schema in `src/db/schema/index.ts` with extensionless module path:

   ```typescript
   export * from './<domain>';
   ```

3. Run migrations:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```

---

## Step 2: Implement DTOs (Zod Request & Query Schemas)

Create `src/modules/<domain>/<domain>.dto.ts`:

```typescript
import { z } from 'zod';

export const createItemDto = z.object({
  title: z.string().min(1).max(200),
});
export type CreateItemDto = z.infer<typeof createItemDto>;

export const listItemsQueryDto = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListItemsQueryDto = z.infer<typeof listItemsQueryDto>;

export const itemIdParamDto = z.object({
  id: z.string().uuid(),
});
export type ItemIdParamDto = z.infer<typeof itemIdParamDto>;
```

---

## Step 3: Implement the Repository Layer (Database Queries)

Create `src/modules/<domain>/<domain>.repository.ts`:

```typescript
import { desc, eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { items, publicItem } from '@/db/schema';

import type { CreateItemDto, ListItemsQueryDto } from './<domain>.dto';

export async function create(userId: string, data: CreateItemDto) {
  const [created] = await db
    .insert(items)
    .values({ userId, ...data })
    .returning(publicItem);
  return created ?? null;
}

export async function findById(id: string) {
  const [item] = await db.select(publicItem).from(items).where(eq(items.id, id)).limit(1);
  return item ?? null;
}

export async function findByUserId(userId: string, { page, limit }: ListItemsQueryDto) {
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

Create `src/modules/<domain>/<domain>.service.ts`:

```typescript
import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';

import type { CreateItemDto, ListItemsQueryDto } from './<domain>.dto';
import * as itemRepo from './<domain>.repository';

export async function createItem(userId: string, data: CreateItemDto) {
  const created = await itemRepo.create(userId, data);
  await cache.delByPrefix(`items:user:${userId}`);
  return created;
}

export const getItemById = (id: string) =>
  cache.wrap(`item:${id}`, 300, async () => {
    const item = await itemRepo.findById(id);
    if (!item) throw AppError.notFound('Item not found');
    return item;
  });

export const listItems = (userId: string, query: ListItemsQueryDto) =>
  cache.wrap(`items:user:${userId}:${query.page}:${query.limit}`, 60, async () => {
    const records = await itemRepo.findByUserId(userId, query);
    return { items: records ?? [], page: query.page, limit: query.limit };
  });
```

---

## Step 5: Implement the Controller Layer (HTTP Request/Response)

Create `src/modules/<domain>/<domain>.controller.ts`:

```typescript
import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import type { CreateItemDto, ItemIdParamDto, ListItemsQueryDto } from './<domain>.dto';
import * as service from './<domain>.service';

export const createItem = asyncHandler(async (req: Request, res: Response) => {
  const body = req.valid?.body as CreateItemDto;
  const result = await service.createItem(req.user!.id, body);
  AppResponse.created(result, 'Item created').send(res);
});

export const listItems = asyncHandler(async (req: Request, res: Response) => {
  const query = req.valid?.query as unknown as ListItemsQueryDto;
  const result = await service.listItems(req.user!.id, query);
  AppResponse.ok(result).send(res);
});

export const getItemById = asyncHandler(async (req: Request, res: Response) => {
  const params = req.valid?.params as ItemIdParamDto;
  const result = await service.getItemById(params.id);
  AppResponse.ok(result).send(res);
});
```

---

## Step 6: Implement the Routes Layer

Create `src/modules/<domain>/<domain>.routes.ts`:

```typescript
import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { validate } from '@/middleware/validate';

import * as controller from './<domain>.controller';
import { createItemDto, itemIdParamDto, listItemsQueryDto } from './<domain>.dto';

const router = Router();
router.use(requireAuth);

router.post('/', validate({ body: createItemDto }), controller.createItem);
router.get('/', validate({ query: listItemsQueryDto }), controller.listItems);
router.get('/:id', validate({ params: itemIdParamDto }), controller.getItemById);

export default router;
```

---

## Step 7: Register Routes in Main Router

Open `src/routes.ts` and register the new module:

```typescript
import itemRoutes from './modules/<domain>/<domain>.routes';

router.use('/<domain>', itemRoutes);
```

---

## Step 8: Add Tests & Verify

Create `test/<domain>.test.ts` and verify types and tests:

```bash
npm run typecheck
npm test
```
