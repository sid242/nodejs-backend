---
name: db-migration
description: >-
  Use this skill when modifying database schema, creating new PostgreSQL tables, generating SQL migrations,
  or running migrations using Drizzle ORM and drizzle-kit in this project.
---

# Database Migration & Schema Workflow

This skill outlines the lifecycle of managing PostgreSQL schemas with Drizzle ORM.

---

## 1. Schema File Structure

All schemas reside in `src/db/schema/`:

- `src/db/schema/enums.ts`: PostgreSQL custom enums (e.g., `roleEnum`, `fileStatusEnum`, `invoiceStatusEnum`).
- `src/db/schema/<domain>.ts`: Domain table definitions (e.g. `users.ts`, `files.ts`, `invoices.ts`, `tenants.ts`, `plans.ts`).
- `src/db/schema/index.ts`: Main schema entrypoint that re-exports all domain schemas using extensionless module paths.

---

## 2. Step-by-Step Migration Guide

### Step 1: Update Schema Definitions

Create or edit a schema file in `src/db/schema/<domain>.ts`:

```typescript
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const products = pgTable('Product', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  sku: text('sku').notNull().unique(),
  createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
```

Make sure `src/db/schema/index.ts` exports the table (`export * from './<domain>';`).

### Step 2: Generate Migration SQL

Run Drizzle Kit to create timestamped SQL migration files under `drizzle/`:

```bash
npm run db:generate
```

Review the newly generated SQL file in `drizzle/` to verify column types, constraints, and indexes.

### Step 3: Verify Integrity & Consistency

Run schema integrity checks:

```bash
npm run db:check
```

### Step 4: Apply Migration

Run migration executor (`src/db/migrate.ts`):

```bash
npm run db:migrate
```

---

## 3. Best Practices & Pitfalls

- **Avoid destructive field drops in production without deprecation cycles**: First make the field nullable, deploy new code, then drop in a subsequent migration.
- **Index every filter and foreign key**: Use `.index()` or `.uniqueIndex()` for columns queried frequently.
- **Pool Management**: The migration script creates a dedicated connection and closes it cleanly via `closeDb()`.
