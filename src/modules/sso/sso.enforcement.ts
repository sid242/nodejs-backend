import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/config/db';
import { tenantMembers } from '@/db/schema/tenancy/tenant-members';
import { tenants } from '@/db/schema/tenancy/tenants';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import { rbacRepo } from '@/modules/rbac/rbac.repository';
import { ssoRepo } from '@/modules/sso/sso.repository';

export interface SsoEnforcementCheck {
  email: string;
  userId?: string;
  targetTenantId?: string;
}

/**
 * Validates that an authentication attempt (password login, magic link, password reset, invitation accept)
 * does not violate the workspace's mandatory SSO policy.
 *
 * If SSO is enforced on the workspace:
 * - Tenant OWNER accounts with `ssoBypass: true` are permitted (break-glass) and audited.
 * - All other accounts are rejected with 403 SSO_REQUIRED and a redirect to SSO initiation.
 */
export async function assertSsoNotEnforced({
  email,
  userId,
  targetTenantId,
}: SsoEnforcementCheck): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const domain = normalizedEmail.split('@')[1]?.toLowerCase().trim();

  let enforcedTenantId: string | null = null;

  // 1. Check if target tenant (if explicitly specified) enforces SSO
  if (targetTenantId) {
    const config = await ssoRepo.findConfigByTenantId(targetTenantId);
    if (config?.status === 'ACTIVE' && config?.enforceSso) {
      enforcedTenantId = targetTenantId;
    }
  }

  // 2. Check if email domain matches an active tenant with enforced SSO
  if (!enforcedTenantId && domain) {
    const activeDomainCfg = await ssoRepo.findActiveConfigByDomain(domain);
    if (activeDomainCfg?.status === 'ACTIVE' && activeDomainCfg?.enforceSso) {
      enforcedTenantId = activeDomainCfg.tenantId;
    }
  }

  // 3. If user exists, check all active tenant memberships for enforced SSO
  if (!enforcedTenantId && userId) {
    const memberships = await db
      .select({
        id: tenantMembers.id,
        tenantId: tenantMembers.tenantId,
        ssoBypass: tenantMembers.ssoBypass,
      })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.userId, userId),
          eq(tenantMembers.status, 'ACTIVE'),
          isNull(tenantMembers.deletedAt),
        ),
      );

    for (const mem of memberships) {
      const cfg = await ssoRepo.findConfigByTenantId(mem.tenantId);
      if (cfg?.status === 'ACTIVE' && cfg?.enforceSso) {
        enforcedTenantId = mem.tenantId;
        break;
      }
    }
  }

  if (!enforcedTenantId) {
    return; // SSO is not enforced
  }

  // 4. Check for Break-Glass Owner Bypass
  if (userId) {
    const [member] = await db
      .select({
        id: tenantMembers.id,
        ssoBypass: tenantMembers.ssoBypass,
      })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, enforcedTenantId),
          eq(tenantMembers.userId, userId),
          eq(tenantMembers.status, 'ACTIVE'),
          isNull(tenantMembers.deletedAt),
        ),
      )
      .limit(1);

    if (member?.ssoBypass) {
      const roles = await rbacRepo.getMemberRoles(member.id);
      const isOwner = roles.some((r) => r.name.toLowerCase() === 'owner');
      if (isOwner) {
        // Log break-glass security audit event
        await logSecurityEvent({
          tenantId: enforcedTenantId,
          userId,
          action: 'SSO.BREAK_GLASS_BYPASS',
          entityType: 'User',
          entityId: userId,
          metadata: {
            email: normalizedEmail,
            reason: 'Break-glass owner password login bypassing SSO enforcement',
          },
        }).catch(() => {});
        return; // Break-glass allowed
      }
    }
  }

  // 5. Enforce SSO: Reject with 403 SSO_REQUIRED
  const [tenant] = await db
    .select({ slug: tenants.slug, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, enforcedTenantId))
    .limit(1);

  throw new AppError(
    403,
    'Single Sign-On is required for your workspace. Please sign in with SSO.',
    'SSO_REQUIRED',
    {
      ssoRequired: true,
      ssoLoginUrl: `/api/v1/auth/sso/initiate?email=${encodeURIComponent(normalizedEmail)}`,
      tenantId: enforcedTenantId,
      tenantSlug: tenant?.slug,
      tenantName: tenant?.name,
    },
  );
}
