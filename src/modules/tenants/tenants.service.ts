import { AppError } from '@/lib/errors.js';
import * as tenantsRepo from './tenants.repository.js';
import * as rbacRepo from '@/modules/rbac/rbac.repository.js';
import * as rbacService from '@/modules/rbac/rbac.service.js';
import * as authRepo from '@/modules/auth/auth.repository.js';
import * as auditRepo from '@/modules/audit/audit.repository.js';
import { logSecurityEvent } from '@/modules/audit/audit.service.js';
import { db } from '@/config/db.js';
import {
  appModules,
  tenantModules,
  type PublicTenant,
  type TenantMember,
} from '@/db/schema/index.js';

export interface CreateTenantDto {
  name: string;
  slug: string;
  plan?: string;
}

export async function createTenantOrganization(
  creatorUserId: string,
  data: CreateTenantDto,
): Promise<PublicTenant> {
  const existing = await tenantsRepo.findTenantBySlug(data.slug);
  if (existing) {
    throw AppError.conflict('A tenant with this slug already exists');
  }

  // 1. Create tenant record
  const tenant = await tenantsRepo.createTenant({
    name: data.name,
    slug: data.slug.toLowerCase().trim(),
    plan: data.plan ?? 'FREE',
    status: 'ACTIVE',
  });

  // 2. Add creator as initial member
  const member = await tenantsRepo.addTenantMember({
    tenantId: tenant.id,
    userId: creatorUserId,
    status: 'ACTIVE',
  });

  // 3. Look up OWNER role (global system role)
  const systemRoles = await rbacRepo.findRolesByTenant(null);
  let ownerRole = systemRoles.find((r) => r.name === rbacService.SYSTEM_ROLES.OWNER);

  if (!ownerRole) {
    // Ensure default system roles are seeded
    await rbacService.seedDefaultRbac();
    const refreshed = await rbacRepo.findRolesByTenant(null);
    ownerRole = refreshed.find((r) => r.name === rbacService.SYSTEM_ROLES.OWNER);
  }

  if (ownerRole) {
    await rbacRepo.assignRoleToMember(member.id, ownerRole.id);
  }

  // 4. Provision default tenant modules
  const allModules = await db.select({ id: appModules.id }).from(appModules);
  if (allModules.length > 0) {
    await db
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

  // 5. Record audit event
  await logSecurityEvent({
    tenantId: tenant.id,
    userId: creatorUserId,
    action: 'TENANT.CREATED',
    entityType: 'Tenant',
    entityId: tenant.id,
    metadata: { name: tenant.name, slug: tenant.slug },
  });

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    plan: tenant.plan,
    createdAt: tenant.createdAt,
  };
}

export async function getUserTenants(userId: string): Promise<PublicTenant[]> {
  return tenantsRepo.findUserTenants(userId);
}

export async function getTenantDetails(tenantId: string): Promise<PublicTenant> {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant || tenant.deletedAt) throw AppError.notFound('Tenant not found');

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    plan: tenant.plan,
    createdAt: tenant.createdAt,
  };
}

export async function updateTenantDetails(
  tenantId: string,
  data: Partial<CreateTenantDto>,
): Promise<PublicTenant> {
  const updated = await tenantsRepo.updateTenant(tenantId, data);
  if (!updated) throw AppError.notFound('Tenant not found');

  return {
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    status: updated.status,
    plan: updated.plan,
    createdAt: updated.createdAt,
  };
}

export async function listMembers(tenantId: string) {
  return tenantsRepo.findTenantMembers(tenantId);
}

export async function addMemberToTenant(
  tenantId: string,
  operatorUserId: string,
  userEmail: string,
  roleName: string = rbacService.SYSTEM_ROLES.MEMBER,
): Promise<{ member: TenantMember; role: string }> {
  const targetUser = await authRepo.findByEmail(userEmail);
  if (!targetUser) {
    throw AppError.notFound(`User with email "${userEmail}" not found. User must register first.`);
  }

  const existing = await tenantsRepo.findTenantMember(tenantId, targetUser.id);
  if (existing) {
    throw AppError.conflict('User is already a member of this tenant');
  }

  const member = await tenantsRepo.addTenantMember({
    tenantId,
    userId: targetUser.id,
    status: 'ACTIVE',
  });

  // Find target role (either custom tenant role or system role)
  const availableRoles = await rbacRepo.findRolesByTenant(tenantId);
  const matchedRole = availableRoles.find((r) => r.name.toLowerCase() === roleName.toLowerCase());

  if (!matchedRole) {
    throw AppError.badRequest(`Role "${roleName}" is not valid for this tenant`);
  }

  await rbacRepo.assignRoleToMember(member.id, matchedRole.id);
  await rbacService.invalidateRbacCache(tenantId, targetUser.id);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'MEMBER.ADDED',
    entityType: 'TenantMember',
    entityId: member.id,
    metadata: { addedUserEmail: userEmail, role: matchedRole.name },
  });

  return { member, role: matchedRole.name };
}

export async function removeMemberFromTenant(
  tenantId: string,
  operatorUserId: string,
  memberId: string,
): Promise<void> {
  const member = await tenantsRepo.findTenantMemberById(memberId);
  if (!member || member.tenantId !== tenantId) {
    throw AppError.notFound('Member not found in this tenant');
  }

  if (member.userId === operatorUserId) {
    throw AppError.badRequest(
      'You cannot remove yourself from the tenant. Transfer ownership first.',
    );
  }

  await tenantsRepo.removeTenantMember(tenantId, memberId);
  await rbacService.invalidateRbacCache(tenantId, member.userId);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'MEMBER.REMOVED',
    entityType: 'TenantMember',
    entityId: memberId,
    metadata: { removedUserId: member.userId },
  });
}

export async function updateMemberRole(
  tenantId: string,
  operatorUserId: string,
  memberId: string,
  newRoleName: string,
): Promise<{ message: string; role: string }> {
  const member = await tenantsRepo.findTenantMemberById(memberId);
  if (!member || member.tenantId !== tenantId) {
    throw AppError.notFound('Member not found in this tenant');
  }

  const availableRoles = await rbacRepo.findRolesByTenant(tenantId);
  const matchedRole = availableRoles.find(
    (r) => r.name.toLowerCase() === newRoleName.toLowerCase(),
  );
  if (!matchedRole) {
    throw AppError.badRequest(`Role "${newRoleName}" is not valid for this tenant`);
  }

  const existingRoles = await rbacRepo.getMemberRoles(member.id);
  for (const r of existingRoles) {
    await rbacRepo.removeRoleFromMember(member.id, r.id);
  }
  await rbacRepo.assignRoleToMember(member.id, matchedRole.id);
  await rbacService.invalidateRbacCache(tenantId, member.userId);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'MEMBER.ROLE_CHANGED',
    entityType: 'TenantMember',
    entityId: member.id,
    metadata: { newRole: matchedRole.name },
  });

  return { message: 'Member role updated successfully', role: matchedRole.name };
}

export async function getTenantAuditTrail(tenantId: string, page = 1, limit = 50) {
  return auditRepo.findAuditLogs({ tenantId, page, limit });
}
