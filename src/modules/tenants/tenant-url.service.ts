import { env } from '@/config/env';
import { cache } from '@/lib/cache';
import type { Tenant, TenantBranding } from '@/db/schema/index';
import type { TenantEntitlements } from '@/modules/billing/billing.service';
import { getTenantEntitlements } from '@/modules/billing/billing.service';
import { tenantBrandingRepo } from './tenant-branding.repository';
import { tenantsRepo } from './tenants.repository';

export type TenantUrlMode = 'path' | 'subdomain' | 'customDomain';
export type UrlFallbackReason = 'PLAN' | 'UNVERIFIED' | 'SUSPENDED' | 'ENV_DISABLED';

export interface EffectiveUrlModeResult {
  mode: TenantUrlMode;
  allowed: {
    path: true;
    subdomain: boolean;
    customDomain: boolean;
  };
  canonicalBase: string;
  reason?: UrlFallbackReason;
}

/**
 * Computes effective URL mode based on plan entitlements, branding, subscription state, and environment modes.
 */
export function getEffectiveUrlMode(
  tenant: Pick<Tenant, 'id' | 'slug' | 'status'> & { urlStyle?: string | null },
  branding: Pick<TenantBranding, 'customDomain' | 'customDomainStatus'> | null | undefined,
  entitlements: Pick<TenantEntitlements, 'limits' | 'subscriptionStatus'> | null | undefined,
  environment: {
    APP_BASE_DOMAIN?: string;
    APP_PROTOCOL?: string;
    TENANCY_MODES?: string;
  } = env,
): EffectiveUrlModeResult {
  const baseDomain = environment.APP_BASE_DOMAIN || 'localhost:3001';
  const protocol = environment.APP_PROTOCOL || (baseDomain.includes('localhost') ? 'http' : 'https');
  const tenancyModes = (environment.TENANCY_MODES || 'path,subdomain,customDomain')
    .split(',')
    .map((m) => m.trim().toLowerCase());

  const urlAccess = entitlements?.limits?.urlAccess ?? {
    path: true,
    subdomain: false,
    customDomain: false,
  };

  const subStatus = entitlements?.subscriptionStatus ?? 'ACTIVE';
  const isSubscriptionActive = ['ACTIVE', 'TRIALING'].includes(subStatus);

  const canSubdomain = Boolean(urlAccess.subdomain && tenancyModes.includes('subdomain'));
  const hasVerifiedDomain = Boolean(
    branding?.customDomain && branding?.customDomainStatus === 'VERIFIED',
  );
  const canCustomDomain = Boolean(
    urlAccess.customDomain &&
      (tenancyModes.includes('customdomain') || tenancyModes.includes('customDomain')) &&
      hasVerifiedDomain &&
      isSubscriptionActive,
  );

  const allowed = {
    path: true as const,
    subdomain: canSubdomain,
    customDomain: canCustomDomain,
  };

  const preferred = (tenant?.urlStyle as TenantUrlMode) || 'path';

  let mode: TenantUrlMode = 'path';
  let reason: UrlFallbackReason | undefined;

  // Check if tenant is suspended or deactivated
  if (tenant?.status === 'SUSPENDED' || tenant?.status === 'DEACTIVATED') {
    reason = 'SUSPENDED';
  }

  if (preferred === 'customDomain') {
    if (allowed.customDomain) {
      mode = 'customDomain';
    } else if (allowed.subdomain) {
      mode = 'subdomain';
      if (!urlAccess.customDomain) {
        reason = reason ?? 'PLAN';
      } else if (!hasVerifiedDomain) {
        reason = reason ?? 'UNVERIFIED';
      } else if (!tenancyModes.includes('customdomain') && !tenancyModes.includes('customDomain')) {
        reason = reason ?? 'ENV_DISABLED';
      }
    } else {
      mode = 'path';
      if (!urlAccess.customDomain && !urlAccess.subdomain) {
        reason = reason ?? 'PLAN';
      } else if (!hasVerifiedDomain) {
        reason = reason ?? 'UNVERIFIED';
      } else {
        reason = reason ?? 'ENV_DISABLED';
      }
    }
  } else if (preferred === 'subdomain') {
    if (allowed.subdomain) {
      mode = 'subdomain';
    } else {
      mode = 'path';
      if (!urlAccess.subdomain) {
        reason = reason ?? 'PLAN';
      } else {
        reason = reason ?? 'ENV_DISABLED';
      }
    }
  } else {
    // Preferred is path
    mode = 'path';
  }

  // Build canonical base URL
  let canonicalBase = `${protocol}://${baseDomain}/w/${tenant.slug}`;
  if (mode === 'subdomain') {
    canonicalBase = `${protocol}://${tenant.slug}.${baseDomain}`;
  } else if (mode === 'customDomain' && branding?.customDomain) {
    canonicalBase = `https://${branding.customDomain.toLowerCase()}`;
  }

  return {
    mode,
    allowed,
    canonicalBase,
    ...(reason ? { reason } : {}),
  };
}

/**
 * Builds the platform URL (non-tenant marketing / login / platform staff).
 */
export function buildPlatformUrl(path = '/'): string {
  const protocol = env.APP_PROTOCOL || (env.PLATFORM_HOST.includes('localhost') ? 'http' : 'https');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${protocol}://${env.PLATFORM_HOST}${cleanPath}`;
}

/**
 * Builds the canonical URL for a tenant workspace.
 * Caches resolution in Redis for 300s.
 */
export async function buildTenantUrl(
  tenantOrId: string | (Tenant & { urlStyle?: string }),
  path = '/',
): Promise<string> {
  const tenantId = typeof tenantOrId === 'string' ? tenantOrId : tenantOrId.id;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  return cache.wrap(`tenant:url:${tenantId}:${cleanPath}`, 300, async () => {
    let tenant: (Tenant & { urlStyle?: string }) | null = null;
    if (typeof tenantOrId === 'string') {
      tenant = await tenantsRepo.findTenantById(tenantId);
    } else {
      tenant = tenantOrId;
    }

    if (!tenant) {
      return buildPlatformUrl(cleanPath);
    }

    const branding = await tenantBrandingRepo.findBrandingByTenantId(tenant.id);
    const entitlements = await getTenantEntitlements(tenant.id);

    const { mode, canonicalBase } = getEffectiveUrlMode(tenant, branding, entitlements, env);

    if (mode === 'path') {
      return `${canonicalBase}${cleanPath}`;
    }

    // Subdomain or custom domain: root path
    return `${canonicalBase}${cleanPath}`;
  });
}

