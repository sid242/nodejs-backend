import { and, desc, eq, isNull } from 'drizzle-orm';

import type { DbExecutor } from '@/config/db';
import { assertTenantScope, primaryDbHandle, tenantDb } from '@/db/tenancy/context';
import { addresses, type Address, type NewAddress } from '@/db/schema/index';

export interface OwnerScope {
  ownerType: 'USER' | 'TENANT' | 'MEMBER';
  ownerId: string;
  tenantId?: string | null;
}

function resolveAddressExecutor(
  scope?: OwnerScope,
  tenantId?: string | null,
  executor?: DbExecutor,
): DbExecutor {
  if (executor) return executor;
  const tid = scope?.tenantId ?? tenantId;
  if (tid) {
    assertTenantScope(tid);
    return tenantDb();
  }
  if (scope?.ownerType === 'TENANT' || scope?.ownerType === 'MEMBER') {
    return tenantDb();
  }
  return primaryDbHandle();
}

export async function findManyByOwner(
  scope: OwnerScope,
  executor?: DbExecutor,
): Promise<Address[]> {
  const exec = resolveAddressExecutor(scope, undefined, executor);
  const conditions = [
    eq(addresses.ownerType, scope.ownerType),
    eq(addresses.ownerId, scope.ownerId),
    isNull(addresses.deletedAt),
  ];

  if (scope.tenantId) {
    conditions.push(eq(addresses.tenantId, scope.tenantId));
  } else if (scope.tenantId === null) {
    conditions.push(isNull(addresses.tenantId));
  }

  return exec
    .select()
    .from(addresses)
    .where(and(...conditions))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
}

export async function findById(
  id: string,
  scope: OwnerScope,
  executor?: DbExecutor,
): Promise<Address | null> {
  const exec = resolveAddressExecutor(scope, undefined, executor);
  const conditions = [
    eq(addresses.id, id),
    eq(addresses.ownerType, scope.ownerType),
    eq(addresses.ownerId, scope.ownerId),
    isNull(addresses.deletedAt),
  ];

  if (scope.tenantId) {
    conditions.push(eq(addresses.tenantId, scope.tenantId));
  } else if (scope.tenantId === null) {
    conditions.push(isNull(addresses.tenantId));
  }

  const [record] = await exec
    .select()
    .from(addresses)
    .where(and(...conditions))
    .limit(1);

  return record ?? null;
}

export async function createAddress(
  data: NewAddress,
  executor?: DbExecutor,
): Promise<Address> {
  const exec = resolveAddressExecutor(undefined, data.tenantId, executor);
  const [created] = await exec.insert(addresses).values(data).returning();
  if (!created) {
    throw new Error('Failed to insert address');
  }
  return created;
}

export async function updateAddress(
  id: string,
  data: Partial<NewAddress>,
  executor?: DbExecutor,
): Promise<Address | null> {
  const exec = resolveAddressExecutor(undefined, data.tenantId, executor);
  const [updated] = await exec
    .update(addresses)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(addresses.id, id))
    .returning();

  return updated ?? null;
}

export async function clearDefaultForOwnerAndType(
  scope: OwnerScope,
  type: string,
  executor?: DbExecutor,
): Promise<void> {
  const exec = resolveAddressExecutor(scope, undefined, executor);
  const conditions = [
    eq(addresses.ownerType, scope.ownerType),
    eq(addresses.ownerId, scope.ownerId),
    eq(addresses.type, type as any),
    eq(addresses.isDefault, true),
    isNull(addresses.deletedAt),
  ];

  if (scope.tenantId) {
    conditions.push(eq(addresses.tenantId, scope.tenantId));
  } else if (scope.tenantId === null) {
    conditions.push(isNull(addresses.tenantId));
  }

  await exec
    .update(addresses)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(...conditions));
}

export async function softDeleteAddress(
  id: string,
  executor?: DbExecutor,
): Promise<Address | null> {
  const exec = executor ?? tenantDb();
  const [deleted] = await exec
    .update(addresses)
    .set({ deletedAt: new Date(), updatedAt: new Date(), isDefault: false })
    .where(eq(addresses.id, id))
    .returning();

  return deleted ?? null;
}

export const addressRepo = {
  findManyByOwner,
  findById,
  createAddress,
  updateAddress,
  clearDefaultForOwnerAndType,
  softDeleteAddress,
};

