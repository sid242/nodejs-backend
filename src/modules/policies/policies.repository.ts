import { and, asc, desc, eq, ilike, isNull, or, sql, SQL } from 'drizzle-orm';

import { db } from '@/config/db';
import { platformRolePolicies, policies, Policy, rolePolicies } from '@/db/schema/access/policies';
import { roles } from '@/db/schema/access/rbac';
import { platformRoles } from '@/db/schema/platform/platform-roles';

import { CreatePolicyDto, ListPoliciesQueryDto, UpdatePolicyDto } from './policies.dto';

export class PoliciesRepository {
  async findPolicyById(tenantId: string, policyId: string): Promise<Policy | null> {
    const [record] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.id, policyId), eq(policies.tenantId, tenantId)))
      .limit(1);

    return record ?? null;
  }

  async findPolicyByName(tenantId: string, name: string): Promise<Policy | null> {
    const [record] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.name, name), eq(policies.tenantId, tenantId)))
      .limit(1);

    return record ?? null;
  }

  async listPolicies(
    tenantId: string,
    filters: ListPoliciesQueryDto,
  ): Promise<{ items: Policy[]; total: number; page: number; limit: number }> {
    const conditions: SQL[] = [eq(policies.tenantId, tenantId)];

    if (filters?.resource) {
      conditions.push(eq(policies.resource, filters.resource));
    }
    if (filters?.action) {
      conditions.push(eq(policies.action, filters.action));
    }
    if (filters?.effect) {
      conditions.push(eq(policies.effect, filters.effect));
    }
    if (filters?.isActive !== undefined) {
      conditions.push(eq(policies.isActive, filters.isActive));
    }
    if (filters?.search) {
      const pattern = `%${filters.search.trim()}%`;
      conditions.push(or(ilike(policies.name, pattern), ilike(policies.description, pattern))!);
    }

    const whereClause = and(...conditions);
    const limit = filters?.limit ?? 20;
    const page = filters?.page ?? 1;
    const offset = (page - 1) * limit;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(policies)
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const items = await db
      .select()
      .from(policies)
      .where(whereClause)
      .orderBy(desc(policies.priority), desc(policies.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: items ?? [],
      total,
      page,
      limit,
    };
  }

  async createPolicy(
    tenantId: string,
    data: CreatePolicyDto,
    createdByUserId?: string,
  ): Promise<Policy> {
    const [created] = await db
      .insert(policies)
      .values({
        tenantId,
        name: data.name,
        description: data.description,
        resource: data.resource,
        action: data.action,
        effect: data.effect,
        conditions: data.conditions,
        priority: data.priority,
        isActive: data.isActive,
        createdBy: createdByUserId,
        updatedBy: createdByUserId,
      })
      .returning();

    if (!created) {
      throw new Error('Failed to create policy');
    }

    return created;
  }

  async updatePolicy(
    tenantId: string,
    policyId: string,
    data: UpdatePolicyDto,
    updatedByUserId?: string,
  ): Promise<Policy | null> {
    const updateValues: Record<string, unknown> = {
      updatedBy: updatedByUserId,
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updateValues.name = data.name;
    if (data.description !== undefined) updateValues.description = data.description;
    if (data.resource !== undefined) updateValues.resource = data.resource;
    if (data.action !== undefined) updateValues.action = data.action;
    if (data.effect !== undefined) updateValues.effect = data.effect;
    if (data.conditions !== undefined) updateValues.conditions = data.conditions;
    if (data.priority !== undefined) updateValues.priority = data.priority;
    if (data.isActive !== undefined) updateValues.isActive = data.isActive;

    const [updated] = await db
      .update(policies)
      .set(updateValues)
      .where(and(eq(policies.id, policyId), eq(policies.tenantId, tenantId)))
      .returning();

    return updated ?? null;
  }

  async deletePolicy(tenantId: string, policyId: string): Promise<boolean> {
    const [deleted] = await db
      .delete(policies)
      .where(and(eq(policies.id, policyId), eq(policies.tenantId, tenantId)))
      .returning();

    return !!deleted;
  }

  async attachPolicyToRole(tenantId: string, roleId: string, policyId: string): Promise<void> {
    await db
      .insert(rolePolicies)
      .values({
        tenantId,
        roleId,
        policyId,
      })
      .onConflictDoNothing();
  }

  async detachPolicyFromRole(tenantId: string, roleId: string, policyId: string): Promise<boolean> {
    const [deleted] = await db
      .delete(rolePolicies)
      .where(
        and(
          eq(rolePolicies.tenantId, tenantId),
          eq(rolePolicies.roleId, roleId),
          eq(rolePolicies.policyId, policyId),
        ),
      )
      .returning();

    return !!deleted;
  }

  async getPoliciesByRoleId(tenantId: string, roleId: string): Promise<Policy[]> {
    const rows = await db
      .select({ policy: policies })
      .from(rolePolicies)
      .innerJoin(policies, eq(rolePolicies.policyId, policies.id))
      .where(and(eq(rolePolicies.tenantId, tenantId), eq(rolePolicies.roleId, roleId)))
      .orderBy(desc(policies.priority), desc(policies.createdAt));

    return rows?.map((r) => r.policy) ?? [];
  }

  async getRolesByPolicyId(
    tenantId: string,
    policyId: string,
  ): Promise<Array<{ id: string; name: string; code: string | null }>> {
    const rows = await db
      .select({
        id: roles.id,
        name: roles.name,
        code: roles.code,
      })
      .from(rolePolicies)
      .innerJoin(roles, eq(rolePolicies.roleId, roles.id))
      .where(and(eq(rolePolicies.tenantId, tenantId), eq(rolePolicies.policyId, policyId)));

    return rows ?? [];
  }

  // ==========================================
  // Platform-Scoped Policies
  // ==========================================

  async findPlatformPolicyById(policyId: string): Promise<Policy | null> {
    const [record] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.id, policyId), isNull(policies.tenantId)))
      .limit(1);

    return record ?? null;
  }

  async findPlatformPolicyByName(name: string): Promise<Policy | null> {
    const [record] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.name, name), isNull(policies.tenantId)))
      .limit(1);

    return record ?? null;
  }

  async listPlatformPolicies(
    filters: ListPoliciesQueryDto,
  ): Promise<{ items: Policy[]; total: number; page: number; limit: number }> {
    const conditions: SQL[] = [isNull(policies.tenantId)];

    if (filters?.resource) {
      conditions.push(eq(policies.resource, filters.resource));
    }
    if (filters?.action) {
      conditions.push(eq(policies.action, filters.action));
    }
    if (filters?.effect) {
      conditions.push(eq(policies.effect, filters.effect));
    }
    if (filters?.isActive !== undefined) {
      conditions.push(eq(policies.isActive, filters.isActive));
    }
    if (filters?.search) {
      const pattern = `%${filters.search.trim()}%`;
      conditions.push(or(ilike(policies.name, pattern), ilike(policies.description, pattern))!);
    }

    const whereClause = and(...conditions);
    const limit = filters?.limit ?? 20;
    const page = filters?.page ?? 1;
    const offset = (page - 1) * limit;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(policies)
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const items = await db
      .select()
      .from(policies)
      .where(whereClause)
      .orderBy(desc(policies.priority), desc(policies.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      items: items ?? [],
      total,
      page,
      limit,
    };
  }

  async createPlatformPolicy(data: CreatePolicyDto, createdByStaffId?: string): Promise<Policy> {
    const [created] = await db
      .insert(policies)
      .values({
        tenantId: null,
        name: data.name,
        description: data.description,
        resource: data.resource,
        action: data.action,
        effect: data.effect,
        conditions: data.conditions,
        priority: data.priority,
        isActive: data.isActive,
      })
      .returning();

    return created!;
  }

  async updatePlatformPolicy(policyId: string, data: UpdatePolicyDto): Promise<Policy | null> {
    const updateValues: Partial<typeof policies.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (data?.name !== undefined) updateValues.name = data.name;
    if (data?.description !== undefined) updateValues.description = data.description;
    if (data?.resource !== undefined) updateValues.resource = data.resource;
    if (data?.action !== undefined) updateValues.action = data.action;
    if (data?.effect !== undefined) updateValues.effect = data.effect;
    if (data?.conditions !== undefined) updateValues.conditions = data.conditions;
    if (data?.priority !== undefined) updateValues.priority = data.priority;
    if (data?.isActive !== undefined) updateValues.isActive = data.isActive;

    const [updated] = await db
      .update(policies)
      .set(updateValues)
      .where(and(eq(policies.id, policyId), isNull(policies.tenantId)))
      .returning();

    return updated ?? null;
  }

  async deletePlatformPolicy(policyId: string): Promise<boolean> {
    const [deleted] = await db
      .delete(policies)
      .where(and(eq(policies.id, policyId), isNull(policies.tenantId)))
      .returning();

    return !!deleted;
  }

  async attachPolicyToPlatformRole(roleId: string, policyId: string): Promise<void> {
    await db
      .insert(platformRolePolicies)
      .values({
        roleId,
        policyId,
      })
      .onConflictDoNothing();
  }

  async detachPolicyFromPlatformRole(roleId: string, policyId: string): Promise<boolean> {
    const [deleted] = await db
      .delete(platformRolePolicies)
      .where(
        and(eq(platformRolePolicies.roleId, roleId), eq(platformRolePolicies.policyId, policyId)),
      )
      .returning();

    return !!deleted;
  }

  async getPoliciesByPlatformRoleId(roleId: string): Promise<Policy[]> {
    const rows = await db
      .select({ policy: policies })
      .from(platformRolePolicies)
      .innerJoin(policies, eq(platformRolePolicies.policyId, policies.id))
      .where(eq(platformRolePolicies.roleId, roleId))
      .orderBy(desc(policies.priority), desc(policies.createdAt));

    return rows?.map((r) => r.policy) ?? [];
  }

  async getPlatformRolesByPolicyId(
    policyId: string,
  ): Promise<Array<{ id: string; name: string; key: string }>> {
    const rows = await db
      .select({
        id: platformRoles.id,
        name: platformRoles.name,
        key: platformRoles.key,
      })
      .from(platformRolePolicies)
      .innerJoin(platformRoles, eq(platformRolePolicies.roleId, platformRoles.id))
      .where(eq(platformRolePolicies.policyId, policyId));

    return rows ?? [];
  }
}

export const policiesRepo = new PoliciesRepository();
