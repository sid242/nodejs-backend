import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/config/db.js';
import {
  tenantMembers,
  tenants,
  users,
  type NewTenant,
  type PublicTenant,
  type Tenant,
  type TenantMember,
} from '@/db/schema/index.js';

export async function createTenant(data: NewTenant): Promise<Tenant> {
  const [record] = await db.insert(tenants).values(data).returning();
  return record!;
}

export async function findTenantById(id: string): Promise<Tenant | null> {
  const [record] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return record ?? null;
}

export async function findTenantBySlug(slug: string): Promise<Tenant | null> {
  const [record] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug.toLowerCase()))
    .limit(1);
  return record ?? null;
}

export async function updateTenant(id: string, data: Partial<NewTenant>): Promise<Tenant | null> {
  const [record] = await db.update(tenants).set(data).where(eq(tenants.id, id)).returning();
  return record ?? null;
}

export async function findUserTenants(userId: string): Promise<PublicTenant[]> {
  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      plan: tenants.plan,
      createdAt: tenants.createdAt,
    })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenantMembers.tenantId, tenants.id))
    .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.status, 'ACTIVE')))
    .orderBy(desc(tenants.createdAt));

  return rows as PublicTenant[];
}
export async function findAllActiveTenants(): Promise<PublicTenant[]> {
  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      plan: tenants.plan,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .where(isNull(tenants.deletedAt))
    .orderBy(desc(tenants.createdAt));

  return rows as PublicTenant[];
}

export async function addTenantMember(data: {
  tenantId: string;
  userId: string;
  status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
}): Promise<TenantMember> {
  const [record] = await db
    .insert(tenantMembers)
    .values({
      tenantId: data.tenantId,
      userId: data.userId,
      status: data.status ?? 'ACTIVE',
    })
    .returning();
  return record!;
}

export async function findTenantMember(
  tenantId: string,
  userId: string,
): Promise<TenantMember | null> {
  const [record] = await db
    .select()
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .limit(1);
  return record ?? null;
}

export async function findTenantMemberById(memberId: string): Promise<TenantMember | null> {
  const [record] = await db
    .select()
    .from(tenantMembers)
    .where(eq(tenantMembers.id, memberId))
    .limit(1);
  return record ?? null;
}

export async function findTenantMembers(tenantId: string): Promise<
  Array<{
    id: string;
    userId: string;
    name: string;
    email: string;
    status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
    joinedAt: Date;
  }>
> {
  return db
    .select({
      id: tenantMembers.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      status: tenantMembers.status,
      joinedAt: tenantMembers.joinedAt,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(eq(tenantMembers.tenantId, tenantId))
    .orderBy(desc(tenantMembers.joinedAt));
}

export async function removeTenantMember(tenantId: string, memberId: string): Promise<boolean> {
  const [deleted] = await db
    .delete(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.id, memberId)))
    .returning();
  return !!deleted;
}

export async function updateTenantMemberStatus(
  memberId: string,
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED',
): Promise<TenantMember | null> {
  const [record] = await db
    .update(tenantMembers)
    .set({ status })
    .where(eq(tenantMembers.id, memberId))
    .returning();
  return record ?? null;
}

export async function findMembershipsByUserId(userId: string): Promise<TenantMember[]> {
  return db.select().from(tenantMembers).where(eq(tenantMembers.userId, userId));
}

export const tenantsRepo = {
  createTenant,
  findTenantById,
  findTenantBySlug,
  updateTenant,
  findUserTenants,
  findAllActiveTenants,
  findMembershipsByUserId,
  addTenantMember,
  findTenantMember,
  findTenantMemberById,
  findTenantMembers,
  removeTenantMember,
  updateTenantMemberStatus,
};
