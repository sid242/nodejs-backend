import { AppError } from '@/lib/errors';
import type { SupportTokenPayload } from '@/modules/auth/tokens';
import * as platformRepo from '@/modules/platform/platform.repository';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

export async function loadActiveSupportAccess(claims: SupportTokenPayload) {
  const session = await platformRepo.findSupportSessionById(claims.sess);
  if (!session || session.staffId !== claims.staffId || session.tenantId !== claims.tenantId) {
    throw AppError.unauthorized('Support session has ended');
  }
  if (session.status !== 'ACTIVE') {
    throw AppError.forbidden(`Support session is currently ${session.status.toLowerCase()}`);
  }
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await platformRepo.terminateSupportSession(session.id, { status: 'EXPIRED' });
    throw AppError.unauthorized('Support session has expired');
  }

  const [staff, tenant, member] = await Promise.all([
    platformRepo.findStaffById(session.staffId),
    tenantsRepo.findTenantById(session.tenantId),
    session.mode === 'AS_MEMBER' && session.targetUserId
      ? tenantsRepo.findTenantMember(session.tenantId, session.targetUserId)
      : null,
  ]);

  if (
    staff?.status !== 'ACTIVE' ||
    !tenant ||
    tenant.deletedAt ||
    tenant.allowSupportAccess === false ||
    !['ACTIVE', 'TRIALING'].includes(tenant.status) ||
    (session.mode === 'AS_MEMBER' &&
      (!member || member.id !== session.targetMemberId || member.status !== 'ACTIVE'))
  ) {
    throw AppError.unauthorized('Support session no longer has workspace access');
  }

  return { session, tenant };
}
