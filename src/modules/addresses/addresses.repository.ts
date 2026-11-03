import { and, desc, eq, isNull } from 'drizzle-orm';

import { db, type DbExecutor } from '@/config/db';
import { addresses, type Address, type NewAddress } from '@/db/schema/index';

export interface OwnerScope {
  ownerType: 'USER' | 'TENANT' | 'MEMBER';
  ownerId: string;
  tenantId?: string | null;
}

export async function findManyByOwner(
  scope: OwnerScope,
  executor: DbExecutor = db,
): Promise<Address[]> {
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

  return executor
    .select()
    .from(addresses)
    .where(and(...conditions))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
}

export async function findById(
  id: string,
  scope: OwnerScope,
  executor: DbExecutor = db,
): Promise<Address | null> {
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

  const [record] = await executor
    .select()
    .from(addresses)
    .where(and(...conditions))
    .limit(1);

  return record ?? null;
}

export async function createAddress(
  data: NewAddress,
  executor: DbExecutor = db,
): Promise<Address> {
  const [created] = await executor.insert(addresses).values(data).returning();
  if (!created) {
    throw new Error('Failed to insert address');
  }
  return created;
}

export async function updateAddress(
  id: string,
  data: Partial<NewAddress>,
  executor: DbExecutor = db,
): Promise<Address | null> {
  const [updated] = await executor
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
  executor: DbExecutor = db,
): Promise<void> {
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

  await executor
    .update(addresses)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(...conditions));
}

export async function softDeleteAddress(
  id: string,
  executor: DbExecutor = db,
): Promise<Address | null> {
  const [deleted] = await executor
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

