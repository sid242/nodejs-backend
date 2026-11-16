import { Policy } from '@/db/schema/access/policies';
import { AppError } from '@/lib/errors';
import { pbacService } from '@/modules/pbac/pbac.service';
import { rbacRepo } from '@/modules/rbac/rbac.repository';

import { CreatePolicyDto, ListPoliciesQueryDto, UpdatePolicyDto } from './policies.dto';
import { policiesRepo } from './policies.repository';

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

    return policiesRepo.createPolicy(tenantId, data, userId);
  }

  async updatePolicy(
    tenantId: string,
    policyId: string,
    data: UpdatePolicyDto,
    userId?: string,
  ): Promise<Policy> {
    await this.getPolicyById(tenantId, policyId);

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

    return updated;
  }

  async deletePolicy(tenantId: string, policyId: string): Promise<void> {
    await this.getPolicyById(tenantId, policyId);

    const linkedRoles = await policiesRepo.getRolesByPolicyId(tenantId, policyId);
    const deleted = await policiesRepo.deletePolicy(tenantId, policyId);
    if (!deleted) {
      throw AppError.notFound('Policy not found');
    }

    // Invalidate PBAC cache for all roles linked to this policy
    await Promise.all(
      linkedRoles.map((r) => pbacService.invalidateRolePoliciesCache(tenantId, r.id)),
    );
  }

  async attachPolicyToRole(
    tenantId: string,
    policyId: string,
    roleId: string,
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

    return { message: `Policy '${policy.name}' attached to role '${role.name}' successfully` };
  }

  async detachPolicyFromRole(
    tenantId: string,
    policyId: string,
    roleId: string,
  ): Promise<{ message: string }> {
    const policy = await this.getPolicyById(tenantId, policyId);
    const role = await rbacRepo.findRoleById(roleId);
    if (!role) {
      throw AppError.notFound('Role not found');
    }

    await policiesRepo.detachPolicyFromRole(tenantId, roleId, policy.id);
    await pbacService.invalidateRolePoliciesCache(tenantId, roleId);

    return { message: `Policy '${policy.name}' detached from role '${role.name}' successfully` };
  }

  async getPoliciesForRole(tenantId: string, roleId: string): Promise<Policy[]> {
    const role = await rbacRepo.findRoleById(roleId);
    if (!role) {
      throw AppError.notFound('Role not found');
    }
    return policiesRepo.getPoliciesByRoleId(tenantId, roleId);
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
    staffId?: string,
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
