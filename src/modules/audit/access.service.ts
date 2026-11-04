import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/config/db';
import {
  appModules,
  permissions,
  rolePermissions,
  roles,
  tenantMemberRoles,
  tenantMembers,
  tenantModules,
  tenants,
  userGroupMembers,
  userGroupRoles,
  userGroups,
  users,
} from '@/db/schema/index';
import { AppError } from '@/lib/errors';

import type { SimulateAccessDto } from './audit.dto';

export interface PermissionProvenance {
  key: string;
  name: string;
  action: string;
  moduleKey?: string | null;
  moduleName?: string | null;
  isAllowed: boolean;
  denialReason?: string | null;
  sources: Array<{
    roleId: string;
    roleName: string;
    roleCode: string;
    source: 'DIRECT' | 'GROUP';
    groupId?: string;
    groupName?: string;
  }>;
}

export interface EffectiveAccessResult {
  user: {
    id: string;
    name: string | null;
    email: string;
    status: string;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan: string;
  };
  membership: {
    id: string;
    status: string;
    joinedAt: Date | null;
  } | null;
  isEffectiveActive: boolean;
  overallDenialReason: string | null;
  directRoles: Array<{
    id: string;
    name: string;
    code: string;
    description: string | null;
    isSystem: boolean;
  }>;
  groups: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    roles: Array<{ id: string; name: string; code: string }>;
  }>;
  groupRoles: Array<{
    id: string;
    name: string;
    code: string;
    groupName: string;
  }>;
  effectiveRoles: string[];
  effectivePermissions: string[];
  permissionsProvenance: PermissionProvenance[];
}

export async function getEffectiveAccess(
  tenantId: string,
  targetUserId: string,
): Promise<EffectiveAccessResult> {
  // 1. Fetch User
  const [userRecord] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (!userRecord) {
    throw AppError.notFound('User not found');
  }

  // 2. Fetch Tenant
  const [tenantRecord] = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      plan: tenants.plan,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenantRecord) {
    throw AppError.notFound('Tenant workspace not found');
  }

  // 3. Fetch Membership
  const [membershipRecord] = await db
    .select({
      id: tenantMembers.id,
      status: tenantMembers.status,
      joinedAt: tenantMembers.joinedAt,
    })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, targetUserId)))
    .limit(1);

  let overallDenialReason: string | null = null;
  if (tenantRecord.status !== 'ACTIVE') {
    overallDenialReason = `Workspace is currently ${tenantRecord.status}. Access to workspace operations is suspended.`;
  } else if (!membershipRecord) {
    overallDenialReason = 'User is not a member of this workspace.';
  } else if (membershipRecord.status !== 'ACTIVE') {
    overallDenialReason = `User membership in this workspace is ${membershipRecord.status}.`;
  } else if (userRecord.status !== 'ACTIVE') {
    overallDenialReason = `User account status is ${userRecord.status}.`;
  }

  const isEffectiveActive = !overallDenialReason;

  // 4. Direct Member Roles
  let directRoles: Array<{
    id: string;
    name: string;
    code: string;
    description: string | null;
    isSystem: boolean;
  }> = [];

  if (membershipRecord) {
    const rawDirect = await db
      .select({
        id: roles.id,
        name: roles.name,
        code: roles.code,
        description: roles.description,
        isSystem: roles.isSystem,
        isActive: roles.isActive,
      })
      .from(tenantMemberRoles)
      .innerJoin(roles, eq(tenantMemberRoles.roleId, roles.id))
      .where(and(eq(tenantMemberRoles.memberId, membershipRecord.id), eq(roles.isActive, true)));

    directRoles = rawDirect.map((r) => ({
      id: r.id,
      name: r.name,
      code: r?.code ?? r.name,
      description: r?.description ?? null,
      isSystem: r.isSystem,
    }));
  }

  // 5. User Group Memberships & Group Roles
  const rawGroupRoles = await db
    .select({
      groupId: userGroups.id,
      groupName: userGroups.name,
      groupSlug: userGroups.slug,
      groupStatus: userGroups.status,
      roleId: roles.id,
      roleName: roles.name,
      roleCode: roles.code,
      roleDescription: roles.description,
      roleIsActive: roles.isActive,
    })
    .from(userGroupMembers)
    .innerJoin(userGroups, eq(userGroupMembers.groupId, userGroups.id))
    .innerJoin(userGroupRoles, eq(userGroupMembers.groupId, userGroupRoles.groupId))
    .innerJoin(roles, eq(userGroupRoles.roleId, roles.id))
    .where(
      and(
        eq(userGroupMembers.userId, targetUserId),
        eq(userGroupMembers.tenantId, tenantId),
        eq(userGroups.status, 'ACTIVE'),
        eq(roles.isActive, true),
      ),
    );

  const groupsMap = new Map<string, {
    id: string;
    name: string;
    slug: string;
    status: string;
    roles: Array<{ id: string; name: string; code: string }>;
  }>();

  const groupRoles: Array<{
    id: string;
    name: string;
    code: string;
    groupName: string;
  }> = [];

  for (const gr of rawGroupRoles) {
    if (!groupsMap.has(gr.groupId)) {
      groupsMap.set(gr.groupId, {
        id: gr.groupId,
        name: gr.groupName,
        slug: gr.groupSlug,
        status: gr.groupStatus,
        roles: [],
      });
    }
    groupsMap.get(gr.groupId)!.roles.push({
      id: gr.roleId,
      name: gr.roleName,
      code: gr?.roleCode ?? gr.roleName,
    });

    groupRoles.push({
      id: gr.roleId,
      name: gr.roleName,
      code: gr?.roleCode ?? gr.roleName,
      groupName: gr.groupName,
    });
  }

  // 6. Disabled Modules for Tenant
  const disabledModules = await db
    .select({ moduleId: tenantModules.moduleId })
    .from(tenantModules)
    .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.isEnabled, false)));
  const disabledModuleIds = new Set(disabledModules.map((d) => d.moduleId));

  // 7. Collect All Active Role IDs
  const allRoleIds = Array.from(
    new Set([...directRoles.map((r) => r.id), ...groupRoles.map((r) => r.id)]),
  );

  // 8. Fetch Role Permissions & Provenance
  const permissionsProvenance: PermissionProvenance[] = [];
  const effectivePermissionsSet = new Set<string>();

  if (allRoleIds.length > 0) {
    const rawPerms = await db
      .select({
        roleId: rolePermissions.roleId,
        permissionId: permissions.id,
        permKey: permissions.key,
        permName: permissions.name,
        permAction: permissions.action,
        permModuleId: permissions.moduleId,
        moduleKey: appModules.key,
        moduleName: appModules.name,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .leftJoin(appModules, eq(permissions.moduleId, appModules.id))
      .where(inArray(rolePermissions.roleId, allRoleIds));

    const permMap = new Map<string, PermissionProvenance>();

    for (const rp of rawPerms) {
      if (!permMap.has(rp.permKey)) {
        const isModuleDisabled = rp.permModuleId ? disabledModuleIds.has(rp.permModuleId) : false;
        let permDenialReason: string | null = overallDenialReason;

        if (!permDenialReason && isModuleDisabled) {
          permDenialReason = `Module "${rp.moduleName || rp.moduleKey}" is disabled for this workspace.`;
        }

        const isAllowed = isEffectiveActive && !isModuleDisabled;
        if (isAllowed) {
          effectivePermissionsSet.add(rp.permKey);
        }

        permMap.set(rp.permKey, {
          key: rp.permKey,
          name: rp.permName,
          action: rp.permAction,
          moduleKey: rp?.moduleKey ?? null,
          moduleName: rp?.moduleName ?? null,
          isAllowed,
          denialReason: permDenialReason,
          sources: [],
        });
      }

      // Identify source (direct or group)
      const directMatch = directRoles.find((r) => r.id === rp.roleId);
      if (directMatch) {
        permMap.get(rp.permKey)!.sources.push({
          roleId: directMatch.id,
          roleName: directMatch.name,
          roleCode: directMatch.code,
          source: 'DIRECT',
        });
      }

      const groupMatches = rawGroupRoles.filter((gr) => gr.roleId === rp.roleId);
      for (const gm of groupMatches) {
        permMap.get(rp.permKey)!.sources.push({
          roleId: gm.roleId,
          roleName: gm.roleName,
          roleCode: gm?.roleCode ?? gm.roleName,
          source: 'GROUP',
          groupId: gm.groupId,
          groupName: gm.groupName,
        });
      }
    }

    permissionsProvenance.push(...permMap.values());
  }

  const effectiveRoles = Array.from(
    new Set([...directRoles.map((r) => r.name), ...groupRoles.map((r) => r.name)]),
  );

  return {
    user: userRecord,
    tenant: tenantRecord,
    membership: membershipRecord ?? null,
    isEffectiveActive,
    overallDenialReason,
    directRoles,
    groups: Array.from(groupsMap.values()),
    groupRoles,
    effectiveRoles,
    effectivePermissions: Array.from(effectivePermissionsSet),
    permissionsProvenance,
  };
}

export interface SimulationResult {
  allowed: boolean;
  reason: string;
  evaluationTrace: string[];
  matchedRoles: string[];
  matchedGroups: string[];
}

/**
 * Zero-Mutation Access Simulator.
 * Simulates permission authorization for any user and scope without modifying database state.
 */
export async function simulateAccess(
  tenantId: string,
  input: SimulateAccessDto,
): Promise<SimulationResult> {
  const trace: string[] = [];
  trace.push(`[INIT] Starting access simulation for user "${input.userId}" on tenant "${tenantId}".`);
  trace.push(`[CHECK] Target permission evaluated: "${input.permission}".`);

  // Step 1: Check Tenant
  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name, status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    trace.push(`[FAIL] Workspace "${tenantId}" does not exist.`);
    return {
      allowed: false,
      reason: 'Tenant workspace does not exist.',
      evaluationTrace: trace,
      matchedRoles: [],
      matchedGroups: [],
    };
  }

  if (tenant.status !== 'ACTIVE') {
    trace.push(`[DENY] Workspace status is "${tenant.status}". Only ACTIVE workspaces permit access.`);
    return {
      allowed: false,
      reason: `Workspace status is "${tenant.status}". Operations are suspended.`,
      evaluationTrace: trace,
      matchedRoles: [],
      matchedGroups: [],
    };
  }
  trace.push(`[PASS] Workspace "${tenant.name}" is ACTIVE.`);

  // Step 2: Check User
  const [user] = await db
    .select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user) {
    trace.push(`[FAIL] User "${input.userId}" does not exist.`);
    return {
      allowed: false,
      reason: 'User account not found.',
      evaluationTrace: trace,
      matchedRoles: [],
      matchedGroups: [],
    };
  }

  if (user.status !== 'ACTIVE') {
    trace.push(`[DENY] User status is "${user.status}". Inactive user accounts cannot access resources.`);
    return {
      allowed: false,
      reason: `User account is "${user.status}".`,
      evaluationTrace: trace,
      matchedRoles: [],
      matchedGroups: [],
    };
  }
  trace.push(`[PASS] User "${user.email}" is ACTIVE.`);

  // Step 3: Check Tenant Membership
  const [member] = await db
    .select({ id: tenantMembers.id, status: tenantMembers.status })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, input.userId)))
    .limit(1);

  if (!member) {
    trace.push(`[DENY] User is not a member of workspace "${tenant.name}".`);
    return {
      allowed: false,
      reason: 'User is not a member of this workspace.',
      evaluationTrace: trace,
      matchedRoles: [],
      matchedGroups: [],
    };
  }

  if (member.status !== 'ACTIVE') {
    trace.push(`[DENY] Workspace membership status is "${member.status}".`);
    return {
      allowed: false,
      reason: `Workspace membership status is "${member.status}".`,
      evaluationTrace: trace,
      matchedRoles: [],
      matchedGroups: [],
    };
  }
  trace.push(`[PASS] Workspace membership is ACTIVE.`);

  // Step 4: Check if permission exists and whether its parent module is enabled
  const [perm] = await db
    .select({
      id: permissions.id,
      key: permissions.key,
      moduleId: permissions.moduleId,
      moduleKey: appModules.key,
      moduleName: appModules.name,
    })
    .from(permissions)
    .leftJoin(appModules, eq(permissions.moduleId, appModules.id))
    .where(eq(permissions.key, input.permission))
    .limit(1);

  if (!perm) {
    trace.push(`[DENY] Permission key "${input.permission}" is not registered in system.`);
    return {
      allowed: false,
      reason: `Unknown permission "${input.permission}".`,
      evaluationTrace: trace,
      matchedRoles: [],
      matchedGroups: [],
    };
  }

  if (perm.moduleId) {
    const [disabledMod] = await db
      .select()
      .from(tenantModules)
      .where(
        and(
          eq(tenantModules.tenantId, tenantId),
          eq(tenantModules.moduleId, perm.moduleId),
          eq(tenantModules.isEnabled, false),
        ),
      )
      .limit(1);

    if (disabledMod) {
      trace.push(
        `[DENY] Parent module "${perm.moduleName || perm.moduleKey}" is explicitly disabled for workspace "${tenant.name}".`,
      );
      return {
        allowed: false,
        reason: `Module "${perm.moduleName || perm.moduleKey}" is disabled for this workspace.`,
        evaluationTrace: trace,
        matchedRoles: [],
        matchedGroups: [],
      };
    }
    trace.push(`[PASS] Parent module "${perm.moduleName || perm.moduleKey}" is enabled.`);
  }

  // Step 5: Direct Roles check
  const directRoles = await db
    .select({
      roleId: roles.id,
      roleName: roles.name,
      roleCode: roles.code,
    })
    .from(tenantMemberRoles)
    .innerJoin(roles, eq(tenantMemberRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
    .where(
      and(
        eq(tenantMemberRoles.memberId, member.id),
        eq(rolePermissions.permissionId, perm.id),
        eq(roles.isActive, true),
      ),
    );

  const matchedRoles: string[] = [];
  const matchedGroups: string[] = [];

  if (directRoles.length > 0) {
    for (const r of directRoles) {
      matchedRoles.push(r.roleName);
      trace.push(`[MATCH] Granted via Direct Role "${r.roleName}" (${r.roleCode}).`);
    }
  }

  // Step 6: Group Roles check
  const groupRoles = await db
    .select({
      groupId: userGroups.id,
      groupName: userGroups.name,
      roleId: roles.id,
      roleName: roles.name,
      roleCode: roles.code,
    })
    .from(userGroupMembers)
    .innerJoin(userGroups, eq(userGroupMembers.groupId, userGroups.id))
    .innerJoin(userGroupRoles, eq(userGroupMembers.groupId, userGroupRoles.groupId))
    .innerJoin(roles, eq(userGroupRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
    .where(
      and(
        eq(userGroupMembers.userId, input.userId),
        eq(userGroupMembers.tenantId, tenantId),
        eq(userGroups.status, 'ACTIVE'),
        eq(roles.isActive, true),
        eq(rolePermissions.permissionId, perm.id),
      ),
    );

  if (groupRoles.length > 0) {
    for (const gr of groupRoles) {
      matchedRoles.push(gr.roleName);
      matchedGroups.push(gr.groupName);
      trace.push(
        `[MATCH] Granted via User Group "${gr.groupName}" -> Role "${gr.roleName}" (${gr.roleCode}).`,
      );
    }
  }

  if (matchedRoles.length === 0) {
    trace.push(
      `[DENY] Neither direct roles nor active group-derived roles grant permission "${input.permission}".`,
    );
    return {
      allowed: false,
      reason: `User lacks permission "${input.permission}".`,
      evaluationTrace: trace,
      matchedRoles: [],
      matchedGroups: [],
    };
  }

  const uniqueRoles = Array.from(new Set(matchedRoles));
  const uniqueGroups = Array.from(new Set(matchedGroups));

  trace.push(`[DECISION: ALLOW] Permission granted via roles: ${uniqueRoles.join(', ')}.`);

  return {
    allowed: true,
    reason: `Allowed via role(s): ${uniqueRoles.join(', ')}${
      uniqueGroups.length > 0 ? ` (inherited from group(s): ${uniqueGroups.join(', ')})` : ''
    }`,
    evaluationTrace: trace,
    matchedRoles: uniqueRoles,
    matchedGroups: uniqueGroups,
  };
}
