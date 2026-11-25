import { and, eq, inArray } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';

import { db } from '@/config/db';
import { groupPolicies, policies, Policy, rolePolicies } from '@/db/schema/access/policies';
import { cache } from '@/lib/cache';

import { compilePoliciesToSqlScope } from './pbac.compiler';
import { evaluatePolicies } from './pbac.evaluator';
import { PBAC_REGISTRY } from './pbac.registry';
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

function getGroupPoliciesCacheKey(tenantId: string, groupId: string): string {
  return `pbac:group:${tenantId}:${groupId}`;
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
   * Fetches all active policies directly bound to a tenant user group.
   */
  async getPoliciesForGroup(tenantId: string, groupId: string): Promise<Policy[]> {
    const cacheKey = getGroupPoliciesCacheKey(tenantId, groupId);

    return cache.wrap(cacheKey, PBAC_CACHE_TTL, async () => {
      const rows = await db
        .select({ policy: policies })
        .from(groupPolicies)
        .innerJoin(policies, eq(groupPolicies.policyId, policies.id))
        .where(
          and(
            eq(groupPolicies.groupId, groupId),
            eq(groupPolicies.tenantId, tenantId),
            eq(policies.isActive, true),
          ),
        );

      return rows?.map((r) => r.policy) ?? [];
    });
  }

  /**
   * Fetches and aggregates all active policies across roles and direct group bindings.
   * Filters by target resource and action.
   */
  async getEffectivePolicies(
    tenantId: string,
    roleIds: string[],
    resource: string,
    action: string,
    groupIds?: string[],
  ): Promise<Policy[]> {
    const hasRoles = Boolean(roleIds && roleIds.length > 0);
    const hasGroups = Boolean(groupIds && groupIds.length > 0);
    if (!hasRoles && !hasGroups) {
      return [];
    }

    const [allRolePolicies, allGroupPolicies] = await Promise.all([
      hasRoles
        ? Promise.all(roleIds.map((rid) => this.getPoliciesForRole(tenantId, rid)))
        : Promise.resolve([]),
      hasGroups
        ? Promise.all((groupIds ?? []).map((gid) => this.getPoliciesForGroup(tenantId, gid)))
        : Promise.resolve([]),
    ]);

    // Deduplicate policies by ID
    const policyMap = new Map<string, Policy>();
    for (const list of [...allRolePolicies, ...allGroupPolicies]) {
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
   * Coarse UI hints for policies that may allow an action. Actual requests still
   * evaluate the full policy set against the actor, record, and environment.
   */
  async getPossiblePermissions(
    tenantId: string,
    roleIds: string[],
    resource: string,
  ): Promise<string[]> {
    const definition = PBAC_REGISTRY.resources.find((entry) => entry.resource === resource);
    if (!definition) return [];
    const allRolePolicies = await Promise.all(
      roleIds.map((roleId) => this.getPoliciesForRole(tenantId, roleId)),
    );
    const allows = allRolePolicies.flat().filter((policy) => policy.effect === 'allow');

    return definition.actions
      .filter((action) =>
        allows.some(
          (policy) =>
            (policy.resource === resource || policy.resource === '*') &&
            (policy.action === action || policy.action === '*'),
        ),
      )
      .map((action) => `${resource}:${action}`);
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
      context.actor?.groupIds,
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
      actorContext?.groupIds,
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

  /**
   * Invalidates cached policies directly bound to a group.
   */
  async invalidateGroupPoliciesCache(tenantId: string, groupId: string): Promise<void> {
    const cacheKey = getGroupPoliciesCacheKey(tenantId, groupId);
    await cache.del(cacheKey);
  }

  /**
   * Invalidates all PBAC role and group policy caches for a tenant.
   */
  async invalidateTenantCache(tenantId: string): Promise<void> {
    await Promise.all([
      cache.delByPrefix(`pbac:role:${tenantId}:`),
      cache.delByPrefix(`pbac:group:${tenantId}:`),
    ]);
  }
}

export const pbacService = new PbacService();
