import { AsyncLocalStorage } from 'node:async_hooks';

import { db as primaryDb, type Database } from '@/config/db';
import { AppError } from '@/lib/errors';

export interface TenantExecutionContext {
  tenantId: string;
  db: Database;
  databaseMode?: 'shared' | 'dedicated' | string;
  tx?: any;
}

const tenantAsyncStorage = new AsyncLocalStorage<TenantExecutionContext>();

/**
 * Runs a function within the context of a specific tenant database.
 * Supports async calls, Promises, and Express route execution chains.
 */
export function runWithTenantDb<T>(ctx: TenantExecutionContext, fn: () => T): T {
  return tenantAsyncStorage.run(ctx, fn);
}

/**
 * Returns the current request/worker tenant database context, if active.
 */
export function currentTenantCtx(): TenantExecutionContext | undefined {
  return tenantAsyncStorage.getStore();
}

/**
 * For tenant-scoped repositories and queries:
 * Returns the tenant-specific database pool (dedicated database for enterprise tenants,
 * or primary shared database with tenant scoping for shared tenants).
 */
export function tenantDb(): Database {
  const store = tenantAsyncStorage.getStore();
  return store?.tx ?? store?.db ?? primaryDb;
}

/**
 * For registry, identity, and platform tables that ALWAYS reside on the primary database cluster
 * (e.g. Tenant registry, Plans, Subscriptions, PlatformStaff, User credentials).
 */
export function primaryDbHandle(): Database {
  return primaryDb;
}

/**
 * Returns the platform database handle for background workers and maintenance tasks.
 */
export function platformDb(): Database {
  return primaryDb;
}

/**
 * Write-path scope assertion guard:
 * Throws a 403 error if the current execution context is bound to a different tenant
 * than the target resource's tenantId, preventing accidental cross-tenant data pollution.
 */
export function assertTenantScope(targetTenantId?: string | null): void {
  if (!targetTenantId) return;

  const ctx = tenantAsyncStorage.getStore();
  if (ctx?.tenantId && ctx.tenantId !== targetTenantId) {
    throw AppError.forbidden(
      `Cross-tenant access violation: operation on tenant '${targetTenantId}' is not permitted within context of tenant '${ctx.tenantId}'`,
      {
        contextTenantId: ctx.tenantId,
        targetTenantId,
      },
    );
  }
}
