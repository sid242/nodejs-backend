import { and, desc, eq, isNull } from 'drizzle-orm';

import { db, type DbExecutor } from '@/config/db';
import {
  appModules,
  plans,
  subscriptionEvents,
  subscriptions,
  tenantMemberRoles,
  tenantMembers,
  tenantModules,
  tenants,
  users,
  type NewTenant,
  type PublicTenant,
  type Tenant,
  type TenantMember,
} from '@/db/schema';
import * as rbacRepo from '@/modules/rbac/rbac.repository';
import * as rbacService from '@/modules/rbac/rbac.service';

export async function createTenant(data: NewTenant, executor: DbExecutor = db): Promise<Tenant> {
  const [record] = await executor.insert(tenants).values(data).returning();
  return record!;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function findTenantById(id: string): Promise<Tenant | null> {
  if (!id || !UUID_REGEX.test(id)) return null;
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

export async function updateTenant(
  id: string,
  data: Partial<NewTenant>,
  executor: DbExecutor = db,
): Promise<Tenant | null> {
  const [record] = await executor.update(tenants).set(data).where(eq(tenants.id, id)).returning();
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

export async function addTenantMember(
  data: {
    tenantId: string;
    userId: string;
    status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  },
  executor: DbExecutor = db,
): Promise<TenantMember> {
  const [record] = await executor
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

export async function provisionTenantTransaction(data: {
  creatorUserId: string;
  name: string;
  slug: string;
  planKey: string;
}): Promise<Tenant> {
  return db.transaction(async (tx) => {
    // 1. Create tenant record
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: data.name,
        slug: data.slug,
        plan: data.planKey,
        status: 'ACTIVE',
      })
      .returning();

    if (!tenant) throw new Error('Failed to create tenant organization');

    // 2. Add creator as initial active member
    const [member] = await tx
      .insert(tenantMembers)
      .values({
        tenantId: tenant.id,
        userId: data.creatorUserId,
        status: 'ACTIVE',
      })
      .returning();

    if (!member) throw new Error('Failed to assign initial tenant member');

    // 3. Resolve OWNER system role
    const systemRoles = await rbacRepo.findRolesByTenant(null);
    let ownerRole = systemRoles?.find((r) => r?.name === rbacService.SYSTEM_ROLES.OWNER);
    if (!ownerRole) {
      await rbacService.seedDefaultRbac();
      const refreshed = await rbacRepo.findRolesByTenant(null);
      ownerRole = refreshed?.find((r) => r?.name === rbacService.SYSTEM_ROLES.OWNER);
    }
    if (ownerRole) {
      await tx
        .insert(tenantMemberRoles)
        .values({
          memberId: member.id,
          roleId: ownerRole.id,
          tenantId: tenant.id,
        })
        .onConflictDoNothing();
    }

    // 4. Provision default tenant modules
    const allModules = await tx.select({ id: appModules.id }).from(appModules);
    if (allModules?.length > 0) {
      await tx
        .insert(tenantModules)
        .values(
          allModules.map((m) => ({
            tenantId: tenant.id,
            moduleId: m.id,
            isEnabled: true,
          })),
        )
        .onConflictDoNothing();
    }

    // 5. Look up plan and assign initial trialing subscription
    const [planRecord] = await tx
      .select()
      .from(plans)
      .where(eq(plans.key, data.planKey.toUpperCase()))
      .limit(1);

    if (planRecord) {
      const trialDays = planRecord.trialDays ?? 14;
      const trialEndsAt = new Date(Date.now() + trialDays * 24 * 3600 * 1000);

      const [sub] = await tx
        .insert(subscriptions)
        .values({
          tenantId: tenant.id,
          planId: planRecord.id,
          status: 'TRIALING',
          trialEndsAt,
          currentPeriodStart: new Date(),
          currentPeriodEnd: trialEndsAt,
          provider: 'manual',
        })
        .returning();

      if (sub) {
        await tx.insert(subscriptionEvents).values({
          subscriptionId: sub.id,
          tenantId: tenant.id,
          type: 'TRIAL_STARTED',
          fromPlanId: null,
          toPlanId: planRecord.id,
          actorType: 'USER',
          actorId: data.creatorUserId,
          metadata: { planKey: data.planKey, trialDays },
        });
      }
    }

    return tenant;
  });
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
  provisionTenantTransaction,
};
