import { AppError } from '@/lib/errors';
import * as authRepo from '@/modules/auth/auth.repository';
import { issueSupportToken } from '@/modules/auth/tokens';
import * as rbacService from '@/modules/rbac/rbac.service';
import { tenantsRepo } from '@/modules/tenants/tenants.repository';

import { resolveActorContext, type StaffActorContext } from './platform-staff.service';
import {
  type ListSupportSessionsQueryDto,
  type QueryPlatformAuditLogsDto,
  type StartSupportSessionDto,
} from './platform.dto';
import { PLATFORM_PERMISSIONS, PLATFORM_ROLES } from './platform.permissions';
import * as platformRepo from './platform.repository';

export async function startSupportSession(
  actor: string | StaffActorContext,
  tenantId: string,
  data: StartSupportSessionDto,
  requestId?: string,
) {
  if (
    typeof actor === 'object' &&
    actor !== null &&
    (actor as StaffActorContext).isSupportSession
  ) {
    throw AppError.forbidden('Nested impersonation is strictly prohibited');
  }

  const actorCtx = await resolveActorContext(actor);
  if (actorCtx.isSupportSession) {
    throw AppError.forbidden('Nested impersonation is strictly prohibited');
  }

  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant || tenant.deletedAt) {
    throw AppError.notFound('Tenant organization not found');
  }

  if (tenant.allowSupportAccess === false) {
    throw AppError.forbidden('This workspace has disabled support access');
  }

  // Auto-promote to AS_MEMBER mode if target user or member is specified
  if ((data.targetUserId || data.targetMemberId) && data.mode === 'TENANT_SCOPED') {
    data.mode = 'AS_MEMBER';
  }

  // 1. Permission checks for scope & mode
  if (
    data.scope === 'FULL' &&
    !actorCtx.permissions.includes(PLATFORM_PERMISSIONS.SUPPORT_WRITE) &&
    actorCtx.roleKey !== PLATFORM_ROLES.SUPER_ADMIN
  ) {
    throw AppError.forbidden(
      'Requires tenant_support:write permission for FULL scope support sessions',
    );
  }

  if (
    data.mode === 'AS_MEMBER' &&
    !actorCtx.permissions.includes(PLATFORM_PERMISSIONS.SUPPORT_IMPERSONATE) &&
    actorCtx.roleKey !== PLATFORM_ROLES.SUPER_ADMIN
  ) {
    throw AppError.forbidden(
      'Requires tenant_support:impersonate permission for AS_MEMBER mode support sessions',
    );
  }

  let targetUserId = data.targetUserId;
  let targetMemberId = data.targetMemberId;

  // 2. Validate target member if AS_MEMBER mode
  if (data.mode === 'AS_MEMBER') {
    let member = null;
    if (targetMemberId) {
      member = await tenantsRepo.findTenantMemberById(targetMemberId);
    } else if (targetUserId) {
      member = await tenantsRepo.findTenantMember(tenantId, targetUserId);
    }

    if (!member || member.status !== 'ACTIVE' || member.tenantId !== tenantId) {
      throw AppError.badRequest('Target member not found or is not active in this workspace');
    }

    const targetUser = await authRepo.findById(member.userId);
    if (!targetUser || targetUser.status !== 'ACTIVE') {
      throw AppError.badRequest('Target member not found or is not active in this workspace');
    }

    targetMemberId = member.id;
    targetUserId = member.userId;

    // Target is not OWNER unless caller is SUPER_ADMIN
    const resolvedTarget = await rbacService.resolveUserPermissions(tenantId, targetUserId);
    const isOwner = resolvedTarget.roles.some(
      (r) => r.toUpperCase() === rbacService.SYSTEM_ROLES.OWNER,
    );
    if (isOwner && actorCtx.roleKey !== PLATFORM_ROLES.SUPER_ADMIN) {
      throw AppError.forbidden(
        'Only Super Admin may initiate a support session targeting a workspace Owner',
      );
    }
  }

  if (
    (data.scope === 'FULL_ADMIN' || data.scope === 'FULL') &&
    !data.tenantConsent &&
    !data.approvedByStaffId &&
    actorCtx.roleKey !== PLATFORM_ROLES.SUPER_ADMIN
  ) {
    throw AppError.forbidden(
      'FULL_ADMIN support session scope requires verified tenant consent or secondary staff approval (four-eyes principle).',
    );
  }

  const durationMinutes = Math.min(120, Math.max(5, data.durationMinutes ?? 30));
  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

  const session = await platformRepo.createSupportSession({
    staffId: actorCtx.id,
    tenantId,
    mode: data.mode,
    scope: data.scope,
    targetUserId: targetUserId ?? null,
    targetMemberId: targetMemberId ?? null,
    reason: data.reason,
    ticketRef: data.ticketRef,
    status: 'ACTIVE',
    expiresAt,
  });

  const { token, expiresInSeconds } = issueSupportToken(
    {
      sess: session.id,
      staffId: session.staffId,
      tenantId: session.tenantId,
      mode: session.mode as 'TENANT_SCOPED' | 'AS_MEMBER',
      scope: session.scope as 'READ_ONLY' | 'ASSIST' | 'FULL' | 'FULL_ADMIN',
      targetUserId: session.targetUserId,
    },
    durationMinutes,
  );

  await platformRepo.logPlatformAction({
    actorStaffId: actorCtx.id,
    action: 'tenant_support.started',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    metadata: {
      sessionId: session.id,
      mode: data.mode,
      scope: data.scope,
      ticketRef: data.ticketRef,
      reason: data.reason,
      durationMinutes,
      targetUserId,
      targetMemberId,
      expiresAt: expiresAt.toISOString(),
    },
    requestId,
  });

  return {
    sessionId: session.id,
    tenantId,
    tenantSlug: tenant.slug,
    mode: session.mode,
    scope: session.scope,
    targetUserId: session.targetUserId ?? null,
    targetMemberId: session.targetMemberId ?? null,
    ticketRef: session.ticketRef,
    reason: session.reason,
    expiresAt,
    status: session.status,
    token,
    accessToken: token,
    expiresInSeconds,
  };
}

export async function enterSupportSession(
  actorStaffId: string,
  sessionId: string,
  requestId?: string,
  isNested?: boolean,
) {
  if (isNested) {
    throw AppError.forbidden('Nested impersonation is strictly prohibited');
  }

  const session = await platformRepo.findSupportSessionById(sessionId);
  if (!session) throw AppError.notFound('Support session not found');

  if (session.staffId !== actorStaffId) {
    throw AppError.forbidden('Only the initiating staff member may enter this support session');
  }

  if (session.status !== 'ACTIVE') {
    throw AppError.forbidden(`Support session is currently ${session.status.toLowerCase()}`);
  }

  const remainingSeconds = Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000);
  if (remainingSeconds <= 0) {
    await platformRepo.terminateSupportSession(sessionId, { status: 'EXPIRED' });
    throw AppError.badRequest('Support session has expired');
  }

  const durationMinutes = Math.min(120, Math.ceil(remainingSeconds / 60));
  const { token, expiresInSeconds } = issueSupportToken(
    {
      sess: session.id,
      staffId: session.staffId,
      tenantId: session.tenantId,
      mode: session.mode as 'TENANT_SCOPED' | 'AS_MEMBER',
      scope: session.scope as 'READ_ONLY' | 'FULL',
      targetUserId: session.targetUserId,
    },
    durationMinutes,
  );

  const tenant = await tenantsRepo.findTenantById(session.tenantId);

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant_support.entered',
    targetType: 'tenant',
    targetId: session.tenantId,
    tenantId: session.tenantId,
    metadata: { sessionId, mode: session.mode, scope: session.scope },
    requestId,
  });

  return {
    token,
    accessToken: token,
    expiresInSeconds,
    sessionId: session.id,
    tenantId: session.tenantId,
    tenantSlug: tenant?.slug,
    mode: session.mode,
    scope: session.scope,
  };
}

export async function listTenantMembers(tenantId: string) {
  return platformRepo.findTenantMembers(tenantId);
}

export async function endSupportSession(
  actor: string | StaffActorContext,
  sessionId: string,
  outcome?: string,
  requestId?: string,
) {
  const actorCtx = await resolveActorContext(actor);
  const session = await platformRepo.findSupportSessionById(sessionId);
  if (!session) throw AppError.notFound('Support session not found');

  const isSuperAdmin = actorCtx.roleKey === PLATFORM_ROLES.SUPER_ADMIN;
  const hasEndAny = actorCtx.permissions.includes(PLATFORM_PERMISSIONS.SUPPORT_END_ANY);
  if (session.staffId !== actorCtx.id && !isSuperAdmin && !hasEndAny) {
    throw AppError.forbidden(
      'Only the initiating staff member or Super Admin may terminate this session',
    );
  }

  const terminated = await platformRepo.terminateSupportSession(sessionId, {
    endedByStaffId: actorCtx.id,
    endOutcome: outcome,
    status: 'TERMINATED',
  });

  await platformRepo.logPlatformAction({
    actorStaffId: actorCtx.id,
    action: 'tenant_support.ended',
    targetType: 'tenant',
    targetId: session.tenantId,
    tenantId: session.tenantId,
    metadata: { sessionId, outcome },
    requestId,
  });

  return terminated;
}

export async function listSupportSessions(filters?: ListSupportSessionsQueryDto) {
  return platformRepo.listSupportSessionsPaginated(filters);
}

// ==========================================
// 4. Audit Trail Queries
// ==========================================

export async function queryAuditLogs(filters: QueryPlatformAuditLogsDto) {
  return platformRepo.queryPlatformAuditLogs(filters);
}

// ==========================================
// 5. Schema Seeder for Canonical Platform Permissions & System Roles
// ==========================================
