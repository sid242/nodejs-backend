import { logger } from '@/config/logger';
import { Policy } from '@/db/schema/access/policies';
import { AppError } from '@/lib/errors';
import { createAuditLog } from '@/modules/audit/audit.repository';
import { evaluateConditionTree, evaluatePolicies } from '@/modules/pbac/pbac.evaluator';
import { pbacService } from '@/modules/pbac/pbac.service';
import {
  ActorContext,
  EvaluationResult,
  PolicyConditionTree,
  PolicyEvaluationContext,
} from '@/modules/pbac/pbac.types';
import { rbacRepo } from '@/modules/rbac/rbac.repository';

import {
  CreatePolicyDto,
  EvaluatePolicyDto,
  ListPoliciesQueryDto,
  UpdatePolicyDto,
} from './policies.dto';
import { policiesRepo } from './policies.repository';

async function safeAuditLog(data: {
  tenantId?: string | null;
  action: string;
  actorUserId?: string | null;
  entityId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await createAuditLog({
      tenantId: data.tenantId ?? null,
      action: data.action,
      entityType: 'policy',
      entityId: data.entityId,
      actorUserId: data.actorUserId ?? null,
      source: 'web',
      result: 'success',
      metadata: data.metadata,
    });
  } catch (err) {
    logger.warn(
      {
        error: err,
        action: data.action,
      },
      'Failed to record audit log for policy operation',
    );
  }
}

export class PoliciesService {
  async listPolicies(
    tenantId: string,
    filters: ListPoliciesQueryDto,
  ): Promise<{ items: Policy[]; total: number; page: number; limit: number }> {
    return policiesRepo.listPolicies(tenantId, filters);
  }

  async getPolicyById(tenantId: string, policyId: string): Promise<Policy> {
    const policy = await policiesRepo.findPolicyById(tenantId, policyId);
    if (!policy) {
      throw AppError.notFound('Policy not found');
    }
    return policy;
  }

  async createPolicy(tenantId: string, data: CreatePolicyDto, userId?: string): Promise<Policy> {
    const existing = await policiesRepo.findPolicyByName(tenantId, data.name);
    if (existing) {
      throw AppError.conflict(`Policy with name '${data.name}' already exists in this workspace`);
    }

    const created = await policiesRepo.createPolicy(tenantId, data, userId);

    await safeAuditLog({
      tenantId,
      action: 'policy.created',
      actorUserId: userId,
      entityId: created.id,
      metadata: { before: null, after: created },
    });

    return created;
  }

  async updatePolicy(
    tenantId: string,
    policyId: string,
    data: UpdatePolicyDto,
    userId?: string,
  ): Promise<Policy> {
    const before = await this.getPolicyById(tenantId, policyId);

    if (data.name) {
      const existing = await policiesRepo.findPolicyByName(tenantId, data.name);
      if (existing && existing.id !== policyId) {
        throw AppError.conflict(`Policy with name '${data.name}' already exists in this workspace`);
      }
    }

    const updated = await policiesRepo.updatePolicy(tenantId, policyId, data, userId);
    if (!updated) {
      throw AppError.notFound('Policy not found');
    }

    // Invalidate PBAC cache for all roles linked to this policy
    const linkedRoles = await policiesRepo.getRolesByPolicyId(tenantId, policyId);
    await Promise.all(
      linkedRoles.map((r) => pbacService.invalidateRolePoliciesCache(tenantId, r.id)),
    );

    await safeAuditLog({
      tenantId,
      action: 'policy.updated',
      actorUserId: userId,
      entityId: policyId,
      metadata: { before, after: updated },
    });

    return updated;
  }

  async deletePolicy(tenantId: string, policyId: string, userId?: string): Promise<void> {
    const before = await this.getPolicyById(tenantId, policyId);

    const linkedRoles = await policiesRepo.getRolesByPolicyId(tenantId, policyId);
    const deleted = await policiesRepo.deletePolicy(tenantId, policyId);
    if (!deleted) {
      throw AppError.notFound('Policy not found');
    }

    // Invalidate PBAC cache for all roles linked to this policy
    await Promise.all(
      linkedRoles.map((r) => pbacService.invalidateRolePoliciesCache(tenantId, r.id)),
    );

    await safeAuditLog({
      tenantId,
      action: 'policy.deleted',
      actorUserId: userId,
      entityId: policyId,
      metadata: { before, after: null },
    });
  }

  async attachPolicyToRole(
    tenantId: string,
    policyId: string,
    roleId: string,
    userId?: string,
  ): Promise<{ message: string }> {
    const policy = await this.getPolicyById(tenantId, policyId);
    const role = await rbacRepo.findRoleById(roleId);
    if (!role) {
      throw AppError.notFound('Role not found');
    }

    if (role.tenantId && role.tenantId !== tenantId) {
      throw AppError.forbidden('Role does not belong to this workspace');
    }

    await policiesRepo.attachPolicyToRole(tenantId, roleId, policy.id);
    await pbacService.invalidateRolePoliciesCache(tenantId, roleId);

    await safeAuditLog({
      tenantId,
      action: 'policy.attached_to_role',
      actorUserId: userId,
      entityId: policyId,
      metadata: { roleId, roleName: role.name },
    });

    return { message: `Policy '${policy.name}' attached to role '${role.name}' successfully` };
  }

  async detachPolicyFromRole(
    tenantId: string,
    policyId: string,
    roleId: string,
    userId?: string,
  ): Promise<{ message: string }> {
    const policy = await this.getPolicyById(tenantId, policyId);
    const role = await rbacRepo.findRoleById(roleId);
    if (!role) {
      throw AppError.notFound('Role not found');
    }

    await policiesRepo.detachPolicyFromRole(tenantId, roleId, policy.id);
    await pbacService.invalidateRolePoliciesCache(tenantId, roleId);

    await safeAuditLog({
      tenantId,
      action: 'policy.detached_from_role',
      actorUserId: userId,
      entityId: policyId,
      metadata: { roleId, roleName: role.name },
    });

    return { message: `Policy '${policy.name}' detached from role '${role.name}' successfully` };
  }

  async getPoliciesForRole(tenantId: string, roleId: string): Promise<Policy[]> {
    const role = await rbacRepo.findRoleById(roleId);
    if (!role) {
      throw AppError.notFound('Role not found');
    }
    return policiesRepo.getPoliciesByRoleId(tenantId, roleId);
  }

  /**
   * Dry-run evaluation endpoint for UI testing panel.
   * Tests policies or candidate conditions without persisting.
   */
  async dryRunEvaluation(tenantId: string, input: EvaluatePolicyDto): Promise<EvaluationResult> {
    const actor: ActorContext = {
      userId: input.actor?.userId ?? 'dry-run-user',
      memberId: input.actor?.memberId ?? 'dry-run-member',
      roleKeys: input.actor?.roleKeys ?? [],
      departmentId: input.actor?.departmentId ?? null,
      regionId: input.actor?.regionId ?? null,
      attributes: input.actor?.attributes ?? {},
    };

    const context: PolicyEvaluationContext = {
      actor,
      resource: input.record ?? {},
      env: { currentTime: new Date() },
    };

    // If an ad-hoc condition tree was provided, test it directly
    if (input.conditions) {
      const matched = evaluateConditionTree(input.conditions as PolicyConditionTree, context);
      return {
        allowed: matched,
        effect: matched ? 'allow' : 'deny',
        traces: [
          {
            policyId: input.policyId ?? 'dry-run-adhoc',
            policyName: 'Dry Run Condition Test',
            effect: 'allow',
            priority: 0,
            matched,
            reason: matched ? 'Condition satisfied' : 'Condition not satisfied',
          },
        ],
      };
    }

    if (input.policyId) {
      const policy = await this.getPolicyById(tenantId, input.policyId);
      return evaluatePolicies([policy], context);
    }

    if (input.roleId) {
      const policies = await this.getPoliciesForRole(tenantId, input.roleId);
      const filtered = policies.filter(
        (p) =>
          (p.resource === input.resource || p.resource === '*') &&
          (p.action === input.action || p.action === '*'),
      );
      return evaluatePolicies(filtered, context);
    }

    // Default: evaluate all active tenant policies matching resource & action
    const allTenantPolicies = await this.listPolicies(tenantId, {
      resource: input.resource,
      action: input.action,
      isActive: true,
      page: 1,
      limit: 100,
    });
    return evaluatePolicies(allTenantPolicies.items, context);
  }

  // ==========================================
  // Platform Policies
  // ==========================================

  async listPlatformPolicies(
    filters: ListPoliciesQueryDto,
  ): Promise<{ items: Policy[]; total: number; page: number; limit: number }> {
    return policiesRepo.listPlatformPolicies(filters);
  }

  async getPlatformPolicyById(policyId: string): Promise<Policy> {
    const policy = await policiesRepo.findPlatformPolicyById(policyId);
    if (!policy) {
      throw AppError.notFound('Platform policy not found');
    }
    return policy;
  }

  async createPlatformPolicy(data: CreatePolicyDto, staffId?: string): Promise<Policy> {
    const existing = await policiesRepo.findPlatformPolicyByName(data.name);
    if (existing) {
      throw AppError.conflict(`Platform policy with name '${data.name}' already exists`);
    }

    return policiesRepo.createPlatformPolicy(data, staffId);
  }

  async updatePlatformPolicy(
    policyId: string,
    data: UpdatePolicyDto,
    _staffId?: string,
  ): Promise<Policy> {
    await this.getPlatformPolicyById(policyId);

    if (data.name) {
      const existing = await policiesRepo.findPlatformPolicyByName(data.name);
      if (existing && existing.id !== policyId) {
        throw AppError.conflict(`Platform policy with name '${data.name}' already exists`);
      }
    }

    const updated = await policiesRepo.updatePlatformPolicy(policyId, data);
    if (!updated) {
      throw AppError.notFound('Platform policy not found');
    }

    return updated;
  }

  async deletePlatformPolicy(policyId: string): Promise<void> {
    await this.getPlatformPolicyById(policyId);

    const deleted = await policiesRepo.deletePlatformPolicy(policyId);
    if (!deleted) {
      throw AppError.notFound('Platform policy not found');
    }
  }

  async attachPolicyToPlatformRole(policyId: string, roleId: string): Promise<{ message: string }> {
    const policy = await this.getPlatformPolicyById(policyId);
    await policiesRepo.attachPolicyToPlatformRole(roleId, policy.id);

    return { message: `Policy '${policy.name}' attached to platform role successfully` };
  }

  async detachPolicyFromPlatformRole(
    policyId: string,
    roleId: string,
  ): Promise<{ message: string }> {
    const policy = await this.getPlatformPolicyById(policyId);
    await policiesRepo.detachPolicyFromPlatformRole(roleId, policy.id);

    return { message: `Policy '${policy.name}' detached from platform role successfully` };
  }

  async getPoliciesForPlatformRole(roleId: string): Promise<Policy[]> {
    return policiesRepo.getPoliciesByPlatformRoleId(roleId);
  }
}

export const policiesService = new PoliciesService();
