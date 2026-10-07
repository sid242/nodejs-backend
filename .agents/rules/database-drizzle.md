# Database & Drizzle ORM Rules

## 1. Schema Definitions
- Define table schemas inside `src/db/schema/<domain>.js` using `drizzle-orm/pg-core`.
- Re-export all tables, enums, and schemas in `src/db/schema/index.js`.
- Always define explicit timestamps (`createdAt`, `updatedAt` with `$onUpdate(() => new Date())`).
- Use UUID primary keys with default random values:
  ```javascript
  import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

  export const orders = pgTable('Order', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: orderStatusEnum('status').notNull().default('PENDING'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  });
  ```

## 2. Projection & Public Select Objects
- Avoid returning raw database rows that may contain sensitive data (hashes, internal flags).
- Define reusable projection objects:
  ```javascript
  export const publicOrder = {
    id: orders.id,
    userId: orders.userId,
    status: orders.status,
    createdAt: orders.createdAt,
  };
  ```

## 3. Querying & Transactions
- Import `db` from `src/config/db.js`.
- For multi-step updates, always use database transactions:
  ```javascript
  await db.transaction(async (tx) => {
    await tx.update(accounts).set(...).where(...);
    await tx.insert(auditLogs).values(...);
  });
  ```
- Always paginate list endpoints. Enforce maximum limits (e.g. `limit <= 100`).

## 4. Connection Pool Constraints
- Connections are managed by `postgres` in `src/config/db.js` with `max: env.DB_POOL_MAX`.
- Keep queries fast and non-blocking. Never run long synchronous tasks while holding a database connection or transaction.

## 5. Migrations Workflow
- Never manually edit generated migration SQL files in `drizzle/` unless dealing with custom data migrations.
- Workflow:
  1. Modify or create schema in `src/db/schema/`.
  2. Run `npm run db:generate` to generate Drizzle SQL files.
  3. Run `npm run db:check` to ensure no schema drifts or collisions.
  4. Run `npm run db:migrate` to execute migrations against the local or target database.
