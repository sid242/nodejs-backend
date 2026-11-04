import { db } from '@/config/db';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import { logPlatformAction } from '@/modules/platform/platform.repository';
import { rbacRepo } from '@/modules/rbac/rbac.repository';
import { invalidateRbacCache } from '@/modules/rbac/rbac.service';

import type {
  AddPlatformGroupMembersInput,
  AddTenantGroupMembersInput,
  BindRoleInput,
  CreateGroupInput,
  ListGroupsQuery,
  UpdateGroupInput,
} from './groups.dto';
import { groupsRepo } from './groups.repository';

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ============================================================================
// TENANT GROUP SERVICES
// ============================================================================

export async function createTenantGroup(
  tenantId: string,
  actorUserId: string,
  input: CreateGroupInput,
) {
  const slug = input.slug ? input.slug.toLowerCase() : slugify(input.name);
  if (!slug) {
    throw AppError.badRequest('Invalid group name for slug generation');
  }

  const existing = await groupsRepo.findGroupBySlug(slug, 'TENANT', tenantId);
  if (existing) {
    throw AppError.conflict(`A group with slug "${slug}" already exists in this workspace`);
  }

  const group = await groupsRepo.createGroup({
    name: input.name,
    slug,
    description: input.description ?? null,
    scope: 'TENANT',
    tenantId,
    status: 'ACTIVE',
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });

  await logSecurityEvent({
    tenantId,
    userId: actorUserId,
    action: 'group:create',
    entityType: 'UserGroup',
    entityId: group.id,
    metadata: {
      name: group.name,
      slug: group.slug,
      scope: 'TENANT',
    },
  });

  return group;
}

export async function listTenantGroups(tenantId: string, query: ListGroupsQuery) {
  return groupsRepo.listGroups({
    scope: 'TENANT',
    tenantId,
    search: query.search,
    status: query.status,
    roleId: query.roleId,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  });
}

export async function getTenantGroup(tenantId: string, groupId: string) {
  const group = await groupsRepo.findGroupById(groupId, 'TENANT', tenantId);
  if (!group) {
    throw AppError.notFound('User group not found');
  }
  return group;
}

export async function updateTenantGroup(
  tenantId: string,
  groupId: string,
  actorUserId: string,
  input: UpdateGroupInput,
) {
  const existing = await groupsRepo.findGroupById(groupId, 'TENANT', tenantId);
  if (!existing) {
    throw AppError.notFound('User group not found');
  }

  if (existing.status === 'ARCHIVED' && input.status !== 'ACTIVE') {
    throw AppError.badRequest('Cannot modify an archived group unless restoring it to ACTIVE status');
  }

  let newSlug: string | undefined = undefined;
  if (input.slug && input.slug.toLowerCase() !== existing.slug) {
    const slugCheck = await groupsRepo.findGroupBySlug(input.slug.toLowerCase(), 'TENANT', tenantId);
    if (slugCheck && slugCheck.id !== groupId) {
      throw AppError.conflict(`A group with slug "${input.slug}" already exists in this workspace`);
    }
    newSlug = input.slug.toLowerCase();
  }

  const updated = await groupsRepo.updateGroup(groupId, 'TENANT', tenantId, {
    ...(input.name ? { name: input.name } : {}),
    ...(newSlug ? { slug: newSlug } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.status ? { status: input.status, archivedAt: input.status === 'ARCHIVED' ? new Date() : null } : {}),
    updatedBy: actorUserId,
  });

  if (!updated) {
    throw AppError.notFound('User group not found');
  }

  await logSecurityEvent({
    tenantId,
    userId: actorUserId,
    action: 'group:update',
    entityType: 'UserGroup',
    entityId: groupId,
    metadata: {
      before: { name: existing.name, slug: existing.slug, status: existing.status },
      after: { name: updated.name, slug: updated.slug, status: updated.status },
    },
  });

  return updated;
}

export async function archiveTenantGroup(
  tenantId: string,
  groupId: string,
  actorUserId: string,
) {
  const existing = await groupsRepo.findGroupById(groupId, 'TENANT', tenantId);
  if (!existing) {
    throw AppError.notFound('User group not found');
  }

  if (existing.status === 'ARCHIVED') {
    return existing;
  }

  const archived = await groupsRepo.archiveGroup(groupId, 'TENANT', tenantId);
  if (!archived) {
    throw AppError.notFound('User group not found');
  }

  await logSecurityEvent({
    tenantId,
    userId: actorUserId,
    action: 'group:archive',
    entityType: 'UserGroup',
    entityId: groupId,
    metadata: {
      name: existing.name,
      slug: existing.slug,
    },
  });

  return archived;
}

export async function addTenantGroupMembers(
  tenantId: string,
  groupId: string,
  actorUserId: string,
  input: AddTenantGroupMembersInput,
) {
  const group = await groupsRepo.findGroupById(groupId, 'TENANT', tenantId);
  if (!group) {
    throw AppError.notFound('User group not found');
  }
  if (group.status === 'ARCHIVED') {
    throw AppError.badRequest('Cannot add members to an archived group');
  }

  // 1. Verify that EVERY target user is an active member of this exact tenant
  const activeTenantUserIds = await groupsRepo.validateActiveTenantMembers(tenantId, input.userIds);
  const inactiveOrNonMembers = input.userIds.filter((id) => !activeTenantUserIds.includes(id));
  if (inactiveOrNonMembers.length > 0) {
    throw AppError.badRequest(
      'One or more users are not active members of this organization',
      { invalidUserIds: inactiveOrNonMembers },
    );
  }

  // 2. Identify members already in this group
  const existingGroupMemberIds = await groupsRepo.findExistingMemberIds(
    groupId,
    input.userIds,
    'TENANT',
  );

  const newMemberIds = input.userIds.filter((id) => !existingGroupMemberIds.includes(id));
  if (newMemberIds.length === 0) {
    return {
      addedCount: 0,
      skippedCount: existingGroupMemberIds.length,
      groupId,
    };
  }

  const newMembersPayload = newMemberIds.map((userId) => ({
    groupId,
    userId,
    tenantId,
    addedBy: actorUserId,
  }));

  const added = await groupsRepo.addGroupMembers(newMembersPayload);

  await logSecurityEvent({
    tenantId,
    userId: actorUserId,
    action: 'group:members_added',
    entityType: 'UserGroup',
    entityId: groupId,
    metadata: {
      addedUserIds: newMemberIds,
      totalAdded: added.length,
    },
  });

  // Invalidate RBAC cache for the tenant
  await invalidateRbacCache(tenantId);

  return {
    addedCount: added.length,
    skippedCount: existingGroupMemberIds.length,
    groupId,
  };
}

export async function removeTenantGroupMember(
  tenantId: string,
  groupId: string,
  actorUserId: string,
  targetUserId: string,
) {
  const group = await groupsRepo.findGroupById(groupId, 'TENANT', tenantId);
  if (!group) {
    throw AppError.notFound('User group not found');
  }

  const removed = await groupsRepo.removeGroupMember(groupId, targetUserId, 'TENANT', tenantId);
  if (!removed) {
    throw AppError.notFound('Member is not in this user group');
  }

  await logSecurityEvent({
    tenantId,
    userId: actorUserId,
    action: 'group:member_removed',
    entityType: 'UserGroup',
    entityId: groupId,
    metadata: {
      removedUserId: targetUserId,
    },
  });

  // Invalidate RBAC cache for the removed user
  await invalidateRbacCache(tenantId, targetUserId);

  return { success: true };
}

export async function listTenantGroupMembers(
  tenantId: string,
  groupId: string,
  page = 1,
  limit = 20,
) {
  const group = await groupsRepo.findGroupById(groupId, 'TENANT', tenantId);
  if (!group) {
    throw AppError.notFound('User group not found');
  }

  return groupsRepo.listTenantGroupMembers(groupId, tenantId, page, limit);
}

// ----------------------------------------------------------------------------
// Tenant Group Role Binding Services
// ----------------------------------------------------------------------------

export async function bindTenantGroupRole(
  tenantId: string,
  groupId: string,
  actorUserId: string,
  input: BindRoleInput,
) {
  const group = await groupsRepo.findGroupById(groupId, 'TENANT', tenantId);
  if (!group) {
    throw AppError.notFound('User group not found');
  }
  if (group.status === 'ARCHIVED') {
    throw AppError.badRequest('Cannot bind roles to an archived group');
  }

  const role = await rbacRepo.findRoleById(input.roleId);
  if (!role) {
    throw AppError.notFound('Role not found');
  }

  // Scope enforcement: tenant group can only bind tenant roles
  if (role.scope !== 'TENANT') {
    throw AppError.badRequest('Cannot bind a platform role to a tenant user group');
  }

  // Cross-tenant mismatch enforcement
  if (role.tenantId && role.tenantId !== tenantId) {
    throw AppError.badRequest('Role does not belong to this organization');
  }

  await groupsRepo.bindRoleToGroup(groupId, input.roleId);

  await logSecurityEvent({
    tenantId,
    userId: actorUserId,
    action: 'group:role_bound',
    entityType: 'UserGroup',
    entityId: groupId,
    metadata: {
      roleId: input.roleId,
      roleName: role.name,
      reason: input.reason,
    },
  });

  // Invalidate RBAC cache for all users in the tenant
  await invalidateRbacCache(tenantId);

  return { success: true, groupId, roleId: input.roleId, roleName: role.name };
}

export async function unbindTenantGroupRole(
  tenantId: string,
  groupId: string,
  actorUserId: string,
  roleId: string,
) {
  const group = await groupsRepo.findGroupById(groupId, 'TENANT', tenantId);
  if (!group) {
    throw AppError.notFound('User group not found');
  }

  const role = await rbacRepo.findRoleById(roleId);
  const unbindSuccess = await groupsRepo.unbindRoleFromGroup(groupId, roleId);
  if (!unbindSuccess) {
    throw AppError.notFound('Role is not bound to this user group');
  }

  await logSecurityEvent({
    tenantId,
    userId: actorUserId,
    action: 'group:role_unbound',
    entityType: 'UserGroup',
    entityId: groupId,
    metadata: {
      roleId,
      roleName: role?.name,
    },
  });

  // Invalidate RBAC cache for all users in the tenant
  await invalidateRbacCache(tenantId);

  return { success: true };
}

export async function listTenantGroupRoles(tenantId: string, groupId: string) {
  const group = await groupsRepo.findGroupById(groupId, 'TENANT', tenantId);
  if (!group) {
    throw AppError.notFound('User group not found');
  }

  return groupsRepo.listGroupRoles(groupId);
}

export async function getTenantGroupPermissions(tenantId: string, groupId: string) {
  const group = await groupsRepo.findGroupById(groupId, 'TENANT', tenantId);
  if (!group) {
    throw AppError.notFound('User group not found');
  }

  const permissions = await groupsRepo.getGroupContributedPermissions(groupId);
  return {
    groupId,
    groupName: group.name,
    permissions,
  };
}

// ============================================================================
// PLATFORM GROUP SERVICES
// ============================================================================

export async function createPlatformGroup(
  actorStaffId: string,
  input: CreateGroupInput,
) {
  const slug = input.slug ? input.slug.toLowerCase() : slugify(input.name);
  if (!slug) {
    throw AppError.badRequest('Invalid group name for slug generation');
  }

  const existing = await groupsRepo.findGroupBySlug(slug, 'PLATFORM');
  if (existing) {
    throw AppError.conflict(`A platform group with slug "${slug}" already exists`);
  }

  const group = await groupsRepo.createGroup({
    name: input.name,
    slug,
    description: input.description ?? null,
    scope: 'PLATFORM',
    tenantId: null,
    status: 'ACTIVE',
    createdBy: actorStaffId,
    updatedBy: actorStaffId,
  });

  await logPlatformAction({
    actorStaffId,
    action: 'platform_group:create',
    targetType: 'platform_group',
    targetId: group.id,
    metadata: {
      name: group.name,
      slug: group.slug,
      scope: 'PLATFORM',
    },
  });

  return group;
}

export async function listPlatformGroups(query: ListGroupsQuery) {
  return groupsRepo.listGroups({
    scope: 'PLATFORM',
    search: query.search,
    status: query.status,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  });
}

export async function getPlatformGroup(groupId: string) {
  const group = await groupsRepo.findGroupById(groupId, 'PLATFORM');
  if (!group) {
    throw AppError.notFound('Platform group not found');
  }
  return group;
}

export async function updatePlatformGroup(
  groupId: string,
  actorStaffId: string,
  input: UpdateGroupInput,
) {
  const existing = await groupsRepo.findGroupById(groupId, 'PLATFORM');
  if (!existing) {
    throw AppError.notFound('Platform group not found');
  }

  if (existing.status === 'ARCHIVED' && input.status !== 'ACTIVE') {
    throw AppError.badRequest('Cannot modify an archived group unless restoring it to ACTIVE status');
  }

  let newSlug: string | undefined = undefined;
  if (input.slug && input.slug.toLowerCase() !== existing.slug) {
    const slugCheck = await groupsRepo.findGroupBySlug(input.slug.toLowerCase(), 'PLATFORM');
    if (slugCheck && slugCheck.id !== groupId) {
      throw AppError.conflict(`A platform group with slug "${input.slug}" already exists`);
    }
    newSlug = input.slug.toLowerCase();
  }

  const updated = await groupsRepo.updateGroup(groupId, 'PLATFORM', undefined, {
    ...(input.name ? { name: input.name } : {}),
    ...(newSlug ? { slug: newSlug } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.status ? { status: input.status, archivedAt: input.status === 'ARCHIVED' ? new Date() : null } : {}),
    updatedBy: actorStaffId,
  });

  if (!updated) {
    throw AppError.notFound('Platform group not found');
  }

  await logPlatformAction({
    actorStaffId,
    action: 'platform_group:update',
    targetType: 'platform_group',
    targetId: groupId,
    metadata: {
      before: { name: existing.name, slug: existing.slug, status: existing.status },
      after: { name: updated.name, slug: updated.slug, status: updated.status },
    },
  });

  return updated;
}

export async function archivePlatformGroup(groupId: string, actorStaffId: string) {
  const existing = await groupsRepo.findGroupById(groupId, 'PLATFORM');
  if (!existing) {
    throw AppError.notFound('Platform group not found');
  }

  if (existing.status === 'ARCHIVED') {
    return existing;
  }

  const archived = await groupsRepo.archiveGroup(groupId, 'PLATFORM');
  if (!archived) {
    throw AppError.notFound('Platform group not found');
  }

  await logPlatformAction({
    actorStaffId,
    action: 'platform_group:archive',
    targetType: 'platform_group',
    targetId: groupId,
    metadata: {
      name: existing.name,
      slug: existing.slug,
    },
  });

  return archived;
}

export async function addPlatformGroupMembers(
  groupId: string,
  actorStaffId: string,
  input: AddPlatformGroupMembersInput,
) {
  const group = await groupsRepo.findGroupById(groupId, 'PLATFORM');
  if (!group) {
    throw AppError.notFound('Platform group not found');
  }
  if (group.status === 'ARCHIVED') {
    throw AppError.badRequest('Cannot add members to an archived group');
  }

  // 1. Verify that EVERY target staff is an active PlatformStaff member
  const activeStaffIds = await groupsRepo.validateActivePlatformStaff(input.staffIds);
  const inactiveStaffIds = input.staffIds.filter((id) => !activeStaffIds.includes(id));
  if (inactiveStaffIds.length > 0) {
    throw AppError.badRequest(
      'One or more staff accounts are not active platform staff members',
      { invalidStaffIds: inactiveStaffIds },
    );
  }

  // 2. Identify staff members already in this group
  const existingGroupStaffIds = await groupsRepo.findExistingMemberIds(
    groupId,
    input.staffIds,
    'PLATFORM',
  );

  const newStaffIds = input.staffIds.filter((id) => !existingGroupStaffIds.includes(id));
  if (newStaffIds.length === 0) {
    return {
      addedCount: 0,
      skippedCount: existingGroupStaffIds.length,
      groupId,
    };
  }

  const newMembersPayload = newStaffIds.map((staffId) => ({
    groupId,
    staffId,
    addedBy: actorStaffId,
  }));

  const added = await groupsRepo.addGroupMembers(newMembersPayload);

  await logPlatformAction({
    actorStaffId,
    action: 'platform_group:members_added',
    targetType: 'platform_group',
    targetId: groupId,
    metadata: {
      addedStaffIds: newStaffIds,
      totalAdded: added.length,
    },
  });

  return {
    addedCount: added.length,
    skippedCount: existingGroupStaffIds.length,
    groupId,
  };
}

export async function removePlatformGroupMember(
  groupId: string,
  actorStaffId: string,
  targetStaffId: string,
) {
  const group = await groupsRepo.findGroupById(groupId, 'PLATFORM');
  if (!group) {
    throw AppError.notFound('Platform group not found');
  }

  const removed = await groupsRepo.removeGroupMember(groupId, targetStaffId, 'PLATFORM');
  if (!removed) {
    throw AppError.notFound('Staff member is not in this platform group');
  }

  await logPlatformAction({
    actorStaffId,
    action: 'platform_group:member_removed',
    targetType: 'platform_group',
    targetId: groupId,
    metadata: {
      removedStaffId: targetStaffId,
    },
  });

  return { success: true };
}

export async function listPlatformGroupMembers(groupId: string, page = 1, limit = 20) {
  const group = await groupsRepo.findGroupById(groupId, 'PLATFORM');
  if (!group) {
    throw AppError.notFound('Platform group not found');
  }

  return groupsRepo.listPlatformGroupMembers(groupId, page, limit);
}

