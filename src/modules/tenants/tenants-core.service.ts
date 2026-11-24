import { eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { env } from '@/config/env';
import { tenantSsoConfigs, type PublicTenant, type Tenant } from '@/db/schema/index';
import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import * as auditRepo from '@/modules/audit/audit.repository';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import * as billingService from '@/modules/billing/billing.service';

import { tenantBrandingRepo } from './tenant-branding.repository';
import { buildPlatformUrl, buildTenantUrl, getEffectiveUrlMode } from './tenant-url.service';
import { isReservedSlug, type CreateTenantDto, type UpdateTenantDto } from './tenants.dto';
import { tenantsRepo } from './tenants.repository';

export const DEFAULT_TENANT_PLAN = 'FREE';

export async function createTenantOrganization(
  creatorUserId: string,
  data: CreateTenantDto,
): Promise<PublicTenant> {
  const cleanSlug = data?.slug?.toLowerCase?.()?.trim?.() ?? '';
  const existing = await tenantsRepo.findTenantBySlug(cleanSlug);
  if (existing) {
    throw AppError.conflict('A tenant with this slug already exists');
  }

  // Provision tenant, owner membership, role, modules, and trialing subscription atomically in repository
  let tenantRecord: Tenant;
  try {
    tenantRecord = await tenantsRepo.provisionTenantTransaction({
      creatorUserId,
      name: data.name,
      slug: cleanSlug,
      planKey: DEFAULT_TENANT_PLAN,
    });
  } catch (err: unknown) {
    const errObj = (typeof err === 'object' && err !== null ? err : {}) as Record<string, unknown>;
    const errMsg = typeof errObj.message === 'string' ? errObj.message : '';
    if (
      errObj?.code === '23505' ||
      errMsg.includes('duplicate key') ||
      errMsg.includes('already exists')
    ) {
      throw AppError.conflict('A tenant with this slug already exists');
    }
    throw err;
  }

  // 6. External side effects: Record security audit event outside the DB transaction
  try {
    await logSecurityEvent({
      tenantId: tenantRecord.id,
      userId: creatorUserId,
      action: 'TENANT.CREATED',
      entityType: 'Tenant',
      entityId: tenantRecord.id,
      metadata: { name: tenantRecord.name, slug: tenantRecord.slug },
    });
  } catch {
    /* ignore logging failure */
  }

  return {
    id: tenantRecord.id,
    name: tenantRecord.name,
    slug: tenantRecord.slug,
    status: tenantRecord.status,
    plan: tenantRecord.plan,
    createdAt: tenantRecord.createdAt,
  };
}

export async function getUserTenants(
  userId: string,
): Promise<Array<PublicTenant & { canonicalBase: string }>> {
  const tenants = await tenantsRepo.findUserTenants(userId);
  return Promise.all(
    tenants.map(async (tenant) => ({
      ...tenant,
      canonicalBase: (await buildTenantUrl(tenant.id, '')).replace(/\/+$/, ''),
    })),
  );
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
    allowSupportAccess: tenant.allowSupportAccess,
    createdAt: tenant.createdAt,
  };
}

export async function updateTenantDetails(
  tenantId: string,
  data: UpdateTenantDto,
  actorUserId?: string,
): Promise<PublicTenant> {
  const current = await tenantsRepo.findTenantById(tenantId);
  if (!current) throw AppError.notFound('Tenant not found');

  if (data.slug && data.slug.toLowerCase() !== current.slug.toLowerCase()) {
    const normalizedSlug = data.slug.toLowerCase();
    const existingWithSlug = await tenantsRepo.findTenantBySlug(normalizedSlug);
    if (existingWithSlug && existingWithSlug.id !== tenantId) {
      throw AppError.conflict('Workspace slug is already taken by another organization.');
    }

    const activeRedirect = await tenantsRepo.findActiveSlugRedirect(normalizedSlug);
    if (activeRedirect && activeRedirect.tenantId !== tenantId) {
      throw AppError.conflict(
        'Workspace slug is currently reserved by a recent organization URL redirect.',
      );
    }

    // Save previous slug in history for 90-day redirect
    await tenantsRepo.recordSlugChange(tenantId, current.slug, 90);

    // Invalidate Redis caches
    await cache.del(`branding:resolve:slug:${current.slug}`);
    await cache.del(`branding:resolve:slug:${normalizedSlug}`);

    if (actorUserId) {
      await auditRepo.createAuditLog({
        tenantId,
        action: 'TENANT.SLUG_CHANGED',
        entityType: 'Tenant',
        entityId: tenantId,
        actorType: 'USER',
        actorUserId,
        metadata: {
          previousSlug: current.slug,
          newSlug: normalizedSlug,
        },
      });
    }
  }

  const updated = await tenantsRepo.updateTenant(tenantId, {
    ...data,
    slug: data.slug ? data.slug.toLowerCase() : undefined,
  });
  if (!updated) throw AppError.notFound('Tenant not found');

  return {
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    status: updated.status,
    plan: updated.plan,
    allowSupportAccess: updated.allowSupportAccess,
    createdAt: updated.createdAt,
  };
}

export function isTenantUnavailable(status?: string | null): boolean {
  return status === 'SUSPENDED' || status === 'DEACTIVATED';
}

export interface PublicTenantResolution {
  kind: 'platform' | 'tenant';
  tenantId?: string;
  slug?: string;
  name?: string;
  status?: string;
  isRedirect?: boolean;
  redirectedFromSlug?: string;
  pathOnly?: boolean;
  canonicalBase?: string;
  urlMode?: 'path' | 'subdomain' | 'customDomain';
  allowed?: {
    path: true;
    subdomain: boolean;
    customDomain: boolean;
  };
  tenant?: {
    id: string;
    name: string;
    slug: string;
    ssoConfigured?: boolean;
  };
  branding?: {
    companyName: string;
    logoUrl: string | null;
    logoDarkUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string;
    accentColor: string;
    secondaryColor?: string | null;
    primaryDarkColor?: string | null;
    accentDarkColor?: string | null;
    secondaryDarkColor?: string | null;
    fontFamily?: string | null;
    sidebarTheme?: string | null;
    borderRadius: string;
    authHeadline?: string | null;
    authSubtitle?: string | null;
    authCoverUrl?: string | null;
    authLayout?: string | null;
    hideWatermark?: boolean;
    customDomain: string | null;
    supportEmail: string | null;
  };
}

/**
 * Resolves a tenant by slug (path /:slug) or subdomain/custom domain with Redis caching.
 */
export async function resolvePublicTenant(options: {
  slug?: string;
  domain?: string;
  host?: string;
}): Promise<PublicTenantResolution> {
  const rawHost = options?.host?.trim().toLowerCase() || options?.domain?.trim().toLowerCase();
  const rawSlug = options?.slug?.trim().toLowerCase();

  if (!rawHost && !rawSlug) {
    throw AppError.badRequest('Either host, domain, or slug must be provided for resolution');
  }

  let host: string | undefined;
  if (rawHost) {
    // 1. Normalize host: lowercase, strip port, strip trailing dots
    let stripped = rawHost.split(':')[0] ?? rawHost;
    stripped = stripped.replace(/\.+$/, '');
    try {
      host = new URL(`http://${stripped}`).hostname.toLowerCase();
    } catch {
      throw AppError.badRequest('Invalid host format');
    }
  }

  const cacheKey = rawSlug
    ? `branding:resolve:slug:${rawSlug}`
    : host
      ? `branding:resolve:${host}`
      : 'branding:resolve:unknown';

  const cached = await cache.get<PublicTenantResolution | { notFound: true }>(cacheKey);
  if (cached) {
    if ('notFound' in cached && cached.notFound) {
      throw new AppError(404, 'Workspace not found', 'TENANT_NOT_FOUND');
    }
    return cached as PublicTenantResolution;
  }

  const baseDomain = env.APP_BASE_DOMAIN.toLowerCase().split(':')[0] ?? 'localhost';
  const platformHost = env.PLATFORM_HOST.toLowerCase().split(':')[0] ?? 'localhost';

  // 2. Slug lookup (prioritized when slug is explicitly requested)
  if (rawSlug) {
    let tenant = await tenantsRepo.findTenantBySlug(rawSlug);
    let isRedirect = false;
    let redirectedFromSlug: string | undefined;

    if (!tenant) {
      const redirectRecord = await tenantsRepo.findActiveSlugRedirect(rawSlug);
      if (redirectRecord) {
        tenant = await tenantsRepo.findTenantById(redirectRecord.tenantId);
        if (tenant) {
          isRedirect = true;
          redirectedFromSlug = rawSlug;
        }
      }
    }

    if (tenant) {
      const branding = await tenantBrandingRepo.findBrandingByTenantId(tenant.id);
      const entitlements = await billingService.getTenantEntitlements(tenant.id);
      const effective = getEffectiveUrlMode(tenant, branding, entitlements, env);

      const [ssoConfig] = await db
        .select({ status: tenantSsoConfigs.status })
        .from(tenantSsoConfigs)
        .where(eq(tenantSsoConfigs.tenantId, tenant.id))
        .limit(1);
      const ssoConfigured = ssoConfig?.status === 'ACTIVE';

      const result: PublicTenantResolution = {
        kind: 'tenant',
        tenantId: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        isRedirect,
        redirectedFromSlug,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          ssoConfigured,
        },
        branding: {
          companyName: branding?.companyName ?? tenant.name,
          logoUrl: branding?.logoUrl ?? null,
          logoDarkUrl: branding?.logoDarkUrl ?? null,
          faviconUrl: branding?.faviconUrl ?? null,
          primaryColor: branding?.primaryColor ?? '#4F46E5',
          accentColor: branding?.accentColor ?? '#06B6D4',
          secondaryColor: branding?.secondaryColor ?? null,
          primaryDarkColor: branding?.primaryDarkColor ?? null,
          accentDarkColor: branding?.accentDarkColor ?? null,
          secondaryDarkColor: branding?.secondaryDarkColor ?? null,
          fontFamily: branding?.fontFamily ?? 'Inter',
          sidebarTheme: branding?.sidebarTheme ?? 'DARK',
          borderRadius: branding?.borderRadius ?? '0.5rem',
          authHeadline: branding?.authHeadline ?? null,
          authSubtitle: branding?.authSubtitle ?? null,
          authCoverUrl: branding?.authCoverUrl ?? null,
          authLayout: branding?.authLayout ?? 'SPLIT',
          hideWatermark: branding?.hideWatermark ?? false,
          customDomain: branding?.customDomain ?? null,
          supportEmail: branding?.supportEmail ?? null,
        },
        urlMode: effective.mode,
        canonicalBase: effective.canonicalBase,
        allowed: effective.allowed,
      };
      await cache.set(cacheKey, result, 300);
      return result;
    }
  }

  // 3. Check if platform host
  if (host && (host === baseDomain || host === platformHost)) {
    const result: PublicTenantResolution = {
      kind: 'platform',
      canonicalBase: buildPlatformUrl(),
    };
    await cache.set(cacheKey, result, 300);
    return result;
  }

  // 3. Check subdomain on base domain (or .localhost in dev)
  if (host) {
    const isSubdomainOfBase = host.endsWith(`.${baseDomain}`);
    const isSubdomainOfLocalhost =
      (baseDomain === 'localhost' || baseDomain.includes('localhost')) &&
      host.endsWith('.localhost');

    if (isSubdomainOfBase || isSubdomainOfLocalhost) {
      const label = isSubdomainOfBase
        ? host.slice(0, -(baseDomain.length + 1))
        : (host.split('.')[0] ?? '');

      if (label && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
        if (isReservedSlug(label)) {
          if (['www', 'app', 'platform'].includes(label)) {
            const result: PublicTenantResolution = {
              kind: 'platform',
              canonicalBase: buildPlatformUrl(),
            };
            await cache.set(cacheKey, result, 300);
            return result;
          }
          await cache.set(cacheKey, { notFound: true }, 30);
          throw new AppError(404, 'Workspace not found', 'TENANT_NOT_FOUND');
        }

        let tenant = await tenantsRepo.findTenantBySlug(label);
        let isRedirect = false;
        let redirectedFromSlug: string | undefined;

        if (!tenant) {
          const redirectRecord = await tenantsRepo.findActiveSlugRedirect(label);
          if (redirectRecord) {
            tenant = await tenantsRepo.findTenantById(redirectRecord.tenantId);
            if (tenant) {
              isRedirect = true;
              redirectedFromSlug = label;
            }
          }
        }

        if (!tenant) {
          await cache.set(cacheKey, { notFound: true }, 30);
          throw new AppError(404, 'Workspace not found', 'TENANT_NOT_FOUND');
        }

        const entitlements = await billingService.getTenantEntitlements(tenant.id);
        const branding = await tenantBrandingRepo.findBrandingByTenantId(tenant.id);
        const effective = getEffectiveUrlMode(tenant, branding, entitlements, env);

        if (!effective.allowed.subdomain || effective.mode !== 'subdomain') {
          const result: PublicTenantResolution = {
            kind: 'tenant',
            tenantId: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            status: tenant.status,
            isRedirect,
            redirectedFromSlug,
            pathOnly: true,
            canonicalBase: effective.canonicalBase,
            urlMode: effective.mode,
            allowed: effective.allowed,
          };
          await cache.set(cacheKey, result, 300);
          return result;
        }

        const [subSsoConfig] = await db
          .select({ status: tenantSsoConfigs.status })
          .from(tenantSsoConfigs)
          .where(eq(tenantSsoConfigs.tenantId, tenant.id))
          .limit(1);
        const subSsoConfigured = subSsoConfig?.status === 'ACTIVE';

        const result: PublicTenantResolution = {
          kind: 'tenant',
          tenantId: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status,
          isRedirect,
          redirectedFromSlug,
          tenant: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            ssoConfigured: subSsoConfigured,
          },
          branding: {
            companyName: branding?.companyName ?? tenant.name,
            logoUrl: branding?.logoUrl ?? null,
            logoDarkUrl: branding?.logoDarkUrl ?? null,
            faviconUrl: branding?.faviconUrl ?? null,
            primaryColor: branding?.primaryColor ?? '#4F46E5',
            accentColor: branding?.accentColor ?? '#06B6D4',
            secondaryColor: branding?.secondaryColor ?? null,
            primaryDarkColor: branding?.primaryDarkColor ?? null,
            accentDarkColor: branding?.accentDarkColor ?? null,
            secondaryDarkColor: branding?.secondaryDarkColor ?? null,
            fontFamily: branding?.fontFamily ?? 'Inter',
            sidebarTheme: branding?.sidebarTheme ?? 'DARK',
            borderRadius: branding?.borderRadius ?? '0.5rem',
            authHeadline: branding?.authHeadline ?? null,
            authSubtitle: branding?.authSubtitle ?? null,
            authCoverUrl: branding?.authCoverUrl ?? null,
            authLayout: branding?.authLayout ?? 'SPLIT',
            customDomain: branding?.customDomain ?? null,
            supportEmail: branding?.supportEmail ?? null,
          },
          urlMode: effective.mode,
          canonicalBase: effective.canonicalBase,
          allowed: effective.allowed,
        };
        await cache.set(cacheKey, result, 300);
        return result;
      }
    }

    // 4. Custom domain lookup (only where customDomainStatus === 'VERIFIED')
    const branding = await tenantBrandingRepo.findBrandingByCustomDomain(host);
    if (branding?.tenantId && branding.customDomainStatus === 'VERIFIED') {
      const tenant = await tenantsRepo.findTenantById(branding.tenantId);
      if (tenant) {
        const entitlements = await billingService.getTenantEntitlements(tenant.id);
        const effective = getEffectiveUrlMode(tenant, branding, entitlements, env);

        if (!effective.allowed.customDomain || effective.mode !== 'customDomain') {
          const result: PublicTenantResolution = {
            kind: 'tenant',
            tenantId: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            status: tenant.status,
            pathOnly: true,
            canonicalBase: effective.canonicalBase,
            urlMode: effective.mode,
            allowed: effective.allowed,
          };
          await cache.set(cacheKey, result, 300);
          return result;
        }

        const [cdSsoConfig] = await db
          .select({ status: tenantSsoConfigs.status })
          .from(tenantSsoConfigs)
          .where(eq(tenantSsoConfigs.tenantId, tenant.id))
          .limit(1);
        const cdSsoConfigured = cdSsoConfig?.status === 'ACTIVE';

        const result: PublicTenantResolution = {
          kind: 'tenant',
          tenantId: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status,
          tenant: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            ssoConfigured: cdSsoConfigured,
          },
          branding: {
            companyName: branding.companyName ?? tenant.name,
            logoUrl: branding.logoUrl ?? null,
            logoDarkUrl: branding.logoDarkUrl ?? null,
            faviconUrl: branding.faviconUrl ?? null,
            primaryColor: branding.primaryColor ?? '#4F46E5',
            accentColor: branding.accentColor ?? '#06B6D4',
            secondaryColor: branding.secondaryColor ?? null,
            primaryDarkColor: branding.primaryDarkColor ?? null,
            accentDarkColor: branding.accentDarkColor ?? null,
            secondaryDarkColor: branding.secondaryDarkColor ?? null,
            fontFamily: branding.fontFamily ?? 'Inter',
            sidebarTheme: branding.sidebarTheme ?? 'DARK',
            borderRadius: branding.borderRadius ?? '0.5rem',
            authHeadline: branding.authHeadline ?? null,
            authSubtitle: branding.authSubtitle ?? null,
            authCoverUrl: branding.authCoverUrl ?? null,
            authLayout: branding.authLayout ?? 'SPLIT',
            hideWatermark: branding.hideWatermark ?? false,
            customDomain: branding.customDomain ?? null,
            supportEmail: branding.supportEmail ?? null,
          },
          urlMode: effective.mode,
          canonicalBase: effective.canonicalBase,
          allowed: effective.allowed,
        };
        await cache.set(cacheKey, result, 300);
        return result;
      }
    }
  }

  // 5. Slug lookup
  if (rawSlug) {
    const tenant = await tenantsRepo.findTenantBySlug(rawSlug);
    if (tenant) {
      const branding = await tenantBrandingRepo.findBrandingByTenantId(tenant.id);
      const entitlements = await billingService.getTenantEntitlements(tenant.id);
      const effective = getEffectiveUrlMode(tenant, branding, entitlements, env);

      const result: PublicTenantResolution = {
        kind: 'tenant',
        tenantId: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
        },
        branding: {
          companyName: branding?.companyName ?? tenant.name,
          logoUrl: branding?.logoUrl ?? null,
          logoDarkUrl: branding?.logoDarkUrl ?? null,
          faviconUrl: branding?.faviconUrl ?? null,
          primaryColor: branding?.primaryColor ?? '#4F46E5',
          accentColor: branding?.accentColor ?? '#06B6D4',
          secondaryColor: branding?.secondaryColor ?? null,
          primaryDarkColor: branding?.primaryDarkColor ?? null,
          accentDarkColor: branding?.accentDarkColor ?? null,
          secondaryDarkColor: branding?.secondaryDarkColor ?? null,
          fontFamily: branding?.fontFamily ?? 'Inter',
          sidebarTheme: branding?.sidebarTheme ?? 'DARK',
          borderRadius: branding?.borderRadius ?? '0.5rem',
          authHeadline: branding?.authHeadline ?? null,
          authSubtitle: branding?.authSubtitle ?? null,
          authCoverUrl: branding?.authCoverUrl ?? null,
          authLayout: branding?.authLayout ?? 'SPLIT',
          hideWatermark: branding?.hideWatermark ?? false,
          customDomain: branding?.customDomain ?? null,
          supportEmail: branding?.supportEmail ?? null,
        },
        urlMode: effective.mode,
        canonicalBase: effective.canonicalBase,
        allowed: effective.allowed,
      };
      await cache.set(cacheKey, result, 300);
      return result;
    }
  }

  // Negative cache for 30s
  await cache.set(cacheKey, { notFound: true }, 30);
  throw new AppError(404, 'Workspace not found', 'TENANT_NOT_FOUND');
}
