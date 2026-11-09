import { and, eq, inArray } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';

import { db } from '@/config/db';
import { policies, Policy, rolePolicies } from '@/db/schema/access/policies';
import { cache } from '@/lib/cache';

import { compilePoliciesToSqlScope } from './pbac.compiler';
import { evaluatePolicies } from './pbac.evaluator';
import {
  ActorContext,
  CompiledScope,
  EvaluationResult,
  PolicyEvaluationContext,
} from './pbac.types';

const PBAC_CACHE_TTL = 300; // 5 minutes

function getRolePoliciesCacheKey(tenantId: string, roleId: string): string {
  return `pbac:role:${tenantId}:${roleId}`;
}

export class PbacService {
  /**
   * Fetches all active policies attached to a given role within a tenant.
   * Utilizes Redis cache-aside with mutex stampede protection.
   */
  async getPoliciesForRole(tenantId: string, roleId: string): Promise<Policy[]> {
    const cacheKey = getRolePoliciesCacheKey(tenantId, roleId);

    return cache.wrap(cacheKey, PBAC_CACHE_TTL, async () => {
      const rows = await db
        .select({ policy: policies })
        .from(rolePolicies)
        .innerJoin(policies, eq(rolePolicies.policyId, policies.id))
        .where(
          and(
            eq(rolePolicies.roleId, roleId),
            eq(rolePolicies.tenantId, tenantId),
            eq(policies.isActive, true),
          ),
        );

      return rows?.map((r) => r.policy) ?? [];
    });
  }

  /**
   * Fetches and aggregates all active policies across multiple roles for a tenant.
   * Filters by target resource and action.
   */
  async getEffectivePolicies(
    tenantId: string,
    roleIds: string[],
    resource: string,
    action: string,
  ): Promise<Policy[]> {
    if (!roleIds || roleIds.length === 0) {
      return [];
    }

    const allRolePolicies = await Promise.all(
      roleIds.map((rid) => this.getPoliciesForRole(tenantId, rid)),
    );

    // Deduplicate policies by ID
    const policyMap = new Map<string, Policy>();
    for (const list of allRolePolicies) {
      for (const policy of list ?? []) {
        if (
          (policy?.resource === resource || policy?.resource === '*') &&
          (policy?.action === action || policy?.action === '*')
        ) {
          policyMap.set(policy.id, policy);
        }
      }
    }

    return Array.from(policyMap.values());
  }

  /**
   * Evaluates access for an actor against a target resource.
   */
  async evaluateAccess(
    tenantId: string,
    roleIds: string[],
    resourceType: string,
    action: string,
    context: PolicyEvaluationContext,
  ): Promise<EvaluationResult> {
    const effectivePolicies = await this.getEffectivePolicies(
      tenantId,
      roleIds,
      resourceType,
      action,
    );

    return evaluatePolicies(effectivePolicies, context);
  }

  /**
   * Compiles SQL query scope for list queries over a resource.
   */
  async compileQueryScope(
    tenantId: string,
    roleIds: string[],
    resourceType: string,
    action: string,
    tableColumns: Record<string, PgColumn>,
    actorContext: ActorContext,
  ): Promise<CompiledScope> {
    const effectivePolicies = await this.getEffectivePolicies(
      tenantId,
      roleIds,
      resourceType,
      action,
    );

    return compilePoliciesToSqlScope(effectivePolicies, tableColumns, actorContext);
  }

  /**
   * Invalidates cached policies for a role.
   */
  async invalidateRolePoliciesCache(tenantId: string, roleId: string): Promise<void> {
    const cacheKey = getRolePoliciesCacheKey(tenantId, roleId);
    await cache.del(cacheKey);
  }
}

export const pbacService = new PbacService();
