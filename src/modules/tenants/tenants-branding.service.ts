import dns from 'node:dns/promises';
import { and, eq, isNotNull } from 'drizzle-orm';

import { db } from '@/config/db';
import { env } from '@/config/env';
import { tenantBrandings, type PublicTenantBranding } from '@/db/schema/index';
import { cache } from '@/lib/cache';
import { addCorsCustomDomain, removeCorsCustomDomain } from '@/lib/cors';
import { AppError } from '@/lib/errors';
import { createUploadPost, ensurePublicBucketPolicies } from '@/lib/s3';
import { safeFilename } from '@/lib/utils';
import * as auditRepo from '@/modules/audit/audit.repository';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import * as billingService from '@/modules/billing/billing.service';
import { emailQueue } from '@/queues/index';
import { emitToRoom } from '@/sockets/emitter';

import { tenantBrandingRepo } from './tenant-branding.repository';
import { getEffectiveUrlMode } from './tenant-url.service';
import {
  type OverrideTenantCustomDomainDto,
  type RequestBrandingUploadUrlDto,
  type UpdateTenantBrandingDto,
  type UpdateTenantUrlSettingsDto,
} from './tenants.dto';
import { tenantsRepo } from './tenants.repository';

export async function getTenantBranding(tenantId: string): Promise<PublicTenantBranding> {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) {
    throw AppError.notFound('Tenant not found');
  }

  await ensurePublicBucketPolicies();

  const branding = await tenantBrandingRepo.findBrandingByTenantId(tenantId);
  if (branding) {
    return branding;
  }

  // Return default placeholder branding if not configured yet
  return {
    id: 'default',
    tenantId,
    companyName: tenant.name,
    logoUrl: null,
    logoDarkUrl: null,
    faviconUrl: null,
    primaryColor: '#4F46E5',
    accentColor: '#06B6D4',
    secondaryColor: null,
    primaryDarkColor: null,
    accentDarkColor: null,
    secondaryDarkColor: null,
    fontFamily: 'Inter',
    sidebarTheme: 'DARK',
    borderRadius: '0.5rem',
    authHeadline: null,
    authSubtitle: null,
    authCoverUrl: null,
    authLayout: 'SPLIT',
    hideWatermark: false,
    customDomain: null,
    customDomainStatus: 'PENDING',
    customDomainVerifiedAt: null,
    customDomainTlsStatus: null,
    supportEmail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function updateTenantBranding(
  tenantId: string,
  operatorUserId: string,
  data: UpdateTenantBrandingDto,
): Promise<PublicTenantBranding> {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) {
    throw AppError.notFound('Tenant not found');
  }

  await ensurePublicBucketPolicies();

  if (data?.customDomain) {
    const entitlements = await billingService.getTenantEntitlements(tenantId);
    if (!entitlements.limits?.urlAccess?.customDomain) {
      throw new AppError(
        403,
        'Custom domain is not available on your plan. Upgrade to Enterprise to configure custom domains.',
        'PLAN_FEATURE_UNAVAILABLE',
        { feature: 'urlAccess.customDomain', requiredPlan: 'ENTERPRISE' },
      );
    }

    const cleanDomain = data.customDomain.toLowerCase().trim();
    const baseDomain = env.APP_BASE_DOMAIN.toLowerCase().split(':')[0] ?? 'localhost';
    if (cleanDomain === baseDomain || cleanDomain.endsWith(`.${baseDomain}`)) {
      throw new AppError(400, 'Custom domain cannot end with base domain', 'DOMAIN_RESERVED');
    }

    const existingDomain = await tenantBrandingRepo.findBrandingByCustomDomain(cleanDomain);
    if (existingDomain && existingDomain.tenantId !== tenantId) {
      throw new AppError(
        409,
        'This custom domain is already registered to another workspace',
        'DOMAIN_ALREADY_IN_USE',
      );
    }
  }

  if (data?.hideWatermark === true) {
    const hasWatermarkEntitlement = await billingService
      .assertQuota(tenantId, 'branding.remove_watermark', 1)
      .then(() => true)
      .catch(() => false);
    if (!hasWatermarkEntitlement) {
      throw new AppError(
        403,
        'Removing platform watermark requires an upgraded Pro or Enterprise subscription.',
        'PLAN_FEATURE_UNAVAILABLE',
        { feature: 'branding.remove_watermark', requiredPlan: 'PRO' },
      );
    }
  }

  if (
    (data?.primaryColor && data.primaryColor !== '#4F46E5') ||
    data?.primaryDarkColor ||
    data?.secondaryDarkColor ||
    data?.accentDarkColor
  ) {
    const hasCustomColors = await billingService
      .assertQuota(tenantId, 'branding.custom_colors', 1)
      .then(() => true)
      .catch(() => false);
    if (!hasCustomColors) {
      throw new AppError(
        403,
        'Custom theme colors and dual-palette overrides require a Pro or Enterprise subscription.',
        'PLAN_FEATURE_UNAVAILABLE',
        { feature: 'branding.custom_colors', requiredPlan: 'PRO' },
      );
    }
  }

  const existing = await tenantBrandingRepo.findBrandingByTenantId(tenantId);

  // If custom domain is modified or removed, sync CORS and verification status
  if (data?.customDomain !== undefined) {
    const nextDomain = data.customDomain ? data.customDomain.toLowerCase().trim() : null;
    if (existing?.customDomain && existing.customDomain.toLowerCase() !== nextDomain) {
      await removeCorsCustomDomain(existing.customDomain);
      await tenantBrandingRepo.updateCustomDomainStatus(
        tenantId,
        'PENDING',
        null,
        nextDomain ? 'PENDING' : null,
      );
      if (!nextDomain && tenant.urlStyle === 'customDomain') {
        await tenantsRepo.updateTenantUrlStyle(tenantId, 'path');
      }
    }
  }

  const updated = await tenantBrandingRepo.upsertTenantBranding({
    tenantId,
    companyName: data?.companyName ?? existing?.companyName ?? tenant.name,
    logoUrl: data?.logoUrl !== undefined ? data.logoUrl : (existing?.logoUrl ?? null),
    logoDarkUrl:
      data?.logoDarkUrl !== undefined ? data.logoDarkUrl : (existing?.logoDarkUrl ?? null),
    faviconUrl: data?.faviconUrl !== undefined ? data.faviconUrl : (existing?.faviconUrl ?? null),
    primaryColor: data?.primaryColor ?? existing?.primaryColor ?? '#4F46E5',
    accentColor: data?.accentColor ?? existing?.accentColor ?? '#06B6D4',
    secondaryColor:
      data?.secondaryColor !== undefined
        ? data.secondaryColor || null
        : (existing?.secondaryColor ?? null),
    primaryDarkColor:
      data?.primaryDarkColor !== undefined
        ? data.primaryDarkColor || null
        : (existing?.primaryDarkColor ?? null),
    accentDarkColor:
      data?.accentDarkColor !== undefined
        ? data.accentDarkColor || null
        : (existing?.accentDarkColor ?? null),
    secondaryDarkColor:
      data?.secondaryDarkColor !== undefined
        ? data.secondaryDarkColor || null
        : (existing?.secondaryDarkColor ?? null),
    fontFamily: data?.fontFamily ?? existing?.fontFamily ?? 'Inter',
    sidebarTheme: data?.sidebarTheme ?? existing?.sidebarTheme ?? 'DARK',
    borderRadius: data?.borderRadius ?? existing?.borderRadius ?? '0.5rem',
    authHeadline:
      data?.authHeadline !== undefined
        ? data.authHeadline || null
        : (existing?.authHeadline ?? null),
    authSubtitle:
      data?.authSubtitle !== undefined
        ? data.authSubtitle || null
        : (existing?.authSubtitle ?? null),
    authCoverUrl:
      data?.authCoverUrl !== undefined
        ? data.authCoverUrl || null
        : (existing?.authCoverUrl ?? null),
    authLayout:
      data?.authLayout !== undefined
        ? data.authLayout || 'SPLIT'
        : (existing?.authLayout ?? 'SPLIT'),
    hideWatermark:
      data?.hideWatermark !== undefined
        ? Boolean(data.hideWatermark)
        : (existing?.hideWatermark ?? false),
    customDomain:
      data?.customDomain !== undefined
        ? data.customDomain
          ? data.customDomain.toLowerCase()
          : null
        : (existing?.customDomain ?? null),
    supportEmail:
      data?.supportEmail !== undefined ? data.supportEmail : (existing?.supportEmail ?? null),
  });

  // Invalidate cached branding entries
  await cache.delByPrefix('branding:resolve:');
  await cache.del(`tenant-branding-email:${tenantId}`);
  await cache.delByPrefix(`tenant:url:${tenantId}`);
  await cache.del(`entitlements:${tenantId}`);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'TENANT.BRANDING_UPDATED',
    entityType: 'TenantBranding',
    entityId: updated.id,
    metadata: {
      primaryColor: updated.primaryColor,
      customDomain: updated.customDomain,
      companyName: updated.companyName,
    },
  });

  emitToRoom(`tenant:${tenantId}`, 'tenant:branding:updated', updated);

  return updated;
}

export async function generateBrandingUploadUrl(
  tenantId: string,
  data: RequestBrandingUploadUrlDto,
): Promise<{ uploadUrl: string; fields: Record<string, string>; key: string; publicUrl: string }> {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) {
    throw AppError.notFound('Tenant not found');
  }

  await ensurePublicBucketPolicies();

  const ext = data?.filename?.split('.').pop()?.toLowerCase() ?? 'png';
  const cleanExt = safeFilename(ext);
  const key = `tenants/${tenantId}/branding/${data.type}-${Date.now()}.${cleanExt}`;

  // Normalize content-type for S3 policy condition and browser compatibility
  let normalizedContentType = data?.contentType ?? 'image/png';
  if (
    ['ico', 'icon'].includes(cleanExt) ||
    [
      'image/x-icon',
      'image/vnd.microsoft.icon',
      'image/ico',
      'image/icon',
      'image/x-ico',
      'application/x-ico',
      'application/octet-stream',
    ].includes(normalizedContentType)
  ) {
    normalizedContentType = 'image/x-icon';
  } else if (cleanExt === 'svg' || normalizedContentType === 'image/svg+xml') {
    normalizedContentType = 'image/svg+xml';
  } else if (
    ['jpg', 'jpeg'].includes(cleanExt) ||
    normalizedContentType === 'image/jpeg' ||
    normalizedContentType === 'image/jpg'
  ) {
    normalizedContentType = 'image/jpeg';
  } else if (cleanExt === 'png' || normalizedContentType === 'image/png') {
    normalizedContentType = 'image/png';
  } else if (cleanExt === 'webp' || normalizedContentType === 'image/webp') {
    normalizedContentType = 'image/webp';
  }

  const post = await createUploadPost({
    key,
    contentType: normalizedContentType,
    expiresIn: 300,
  });

  const publicUrl = env.S3_ENDPOINT
    ? `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`
    : `https://${env.S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;

  return {
    uploadUrl: post.url,
    fields: post.fields,
    key,
    publicUrl,
  };
}

async function invalidateTenantBrandingAndUrlCaches(tenantId: string): Promise<void> {
  await cache.delByPrefix('branding:resolve:');
  await cache.delByPrefix(`tenant:url:${tenantId}`);
  await cache.del(`entitlements:${tenantId}`);
}

export async function verifyTenantCustomDomain(
  tenantId: string,
  operatorUserId: string,
  bypassVerification = false,
): Promise<PublicTenantBranding> {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) {
    throw AppError.notFound('Tenant not found');
  }

  await ensurePublicBucketPolicies();

  // Plan gate: custom domain requires Enterprise unless staff bypasses
  if (!bypassVerification) {
    const entitlements = await billingService.getTenantEntitlements(tenantId);
    if (!entitlements.limits?.urlAccess?.customDomain) {
      throw new AppError(
        403,
        'Custom domain feature is not available on your current plan. Upgrade to Enterprise to verify custom domains.',
        'PLAN_FEATURE_UNAVAILABLE',
        { feature: 'urlAccess.customDomain', requiredPlan: 'ENTERPRISE' },
      );
    }
  }

  const branding = await tenantBrandingRepo.findBrandingByTenantId(tenantId);
  if (!branding || !branding.customDomain) {
    throw AppError.badRequest(
      'No custom domain configured for this workspace. Set a custom domain first before verifying.',
    );
  }

  const domain = branding.customDomain.toLowerCase();
  const challengeHostname = `_saas-verify.${domain}`;
  const expectedValue = `saas-verify=${tenantId}`;

  if (!bypassVerification) {
    try {
      const records = await dns.resolveTxt(challengeHostname);
      const flatRecords = records.flat();
      const matched = flatRecords.some(
        (entry) => entry.trim() === expectedValue || entry.trim() === tenantId,
      );

      if (!matched) {
        await tenantBrandingRepo.updateCustomDomainStatus(tenantId, 'FAILED', null, 'FAILED');
        throw new AppError(
          400,
          `DNS TXT record on "${challengeHostname}" did not match expected verification token "${expectedValue}". Found: [${flatRecords.join(', ')}]`,
          'DOMAIN_NOT_VERIFIED',
        );
      }
    } catch (err: unknown) {
      await tenantBrandingRepo.updateCustomDomainStatus(tenantId, 'FAILED', null, 'FAILED');
      if (err instanceof AppError) throw err;
      throw new AppError(
        400,
        `Failed to resolve DNS TXT record for "${challengeHostname}". Ensure the DNS TXT record is configured with "${expectedValue}" and has propagated.`,
        'DOMAIN_NOT_VERIFIED',
        { cause: (err as Error)?.message },
      );
    }
  }

  const updated = await tenantBrandingRepo.updateCustomDomainStatus(
    tenantId,
    'VERIFIED',
    new Date(),
    'ISSUED',
  );
  if (!updated) {
    throw AppError.internal('Failed to update domain verification status');
  }

  await addCorsCustomDomain(domain);
  await invalidateTenantBrandingAndUrlCaches(tenantId);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'TENANT.DOMAIN_VERIFIED',
    entityType: 'TenantBranding',
    entityId: updated.id,
    metadata: {
      customDomain: updated.customDomain,
      customDomainStatus: 'VERIFIED',
      challengeHostname,
      bypassVerification,
    },
  });

  emitToRoom(`tenant:${tenantId}`, 'tenant:domain:verified', updated);

  return updated;
}

export async function reverifyAllVerifiedDomains(): Promise<{ verified: number; failed: number }> {
  const verifiedBrandings = await db
    .select()
    .from(tenantBrandings)
    .where(
      and(
        eq(tenantBrandings.customDomainStatus, 'VERIFIED'),
        isNotNull(tenantBrandings.customDomain),
      ),
    );

  let verified = 0;
  let failed = 0;

  for (const branding of verifiedBrandings) {
    if (!branding?.customDomain || !branding?.tenantId) continue;
    const domain = branding.customDomain.toLowerCase();
    const challengeHostname = `_saas-verify.${domain}`;
    const expectedValue = `saas-verify=${branding.tenantId}`;

    let matched = false;
    try {
      const records = await dns.resolveTxt(challengeHostname);
      const flatRecords = records?.flat?.() ?? [];
      matched = flatRecords.some(
        (entry) => entry?.trim?.() === expectedValue || entry?.trim?.() === branding.tenantId,
      );
    } catch {
      matched = false;
    }

    if (!matched) {
      failed++;
      await tenantBrandingRepo.updateCustomDomainStatus(
        branding.tenantId,
        'FAILED',
        null,
        'FAILED',
      );
      await removeCorsCustomDomain(domain);
      await invalidateTenantBrandingAndUrlCaches(branding.tenantId);

      try {
        const members = await tenantsRepo.findTenantMembers(branding.tenantId);
        const owner = members?.find?.((m) => m?.status === 'ACTIVE');
        if (owner?.email) {
          await emailQueue
            .add(
              'custom-domain-failed',
              {
                to: owner.email,
                domain,
                tenantId: branding.tenantId,
              },
              { jobId: `domain-failed-${branding.tenantId}-${Date.now()}` },
            )
            .catch(() => undefined);
        }
      } catch {
        /* non-blocking */
      }
    } else {
      verified++;
    }
  }

  return { verified, failed };
}

export async function getTenantUrlSettings(tenantId: string) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const branding = await tenantBrandingRepo.findBrandingByTenantId(tenantId);
  const entitlements = await billingService.getTenantEntitlements(tenantId);
  const effective = getEffectiveUrlMode(tenant, branding, entitlements, env);

  const baseDomain = env.APP_BASE_DOMAIN || 'localhost:3001';
  const protocol = env.APP_PROTOCOL || (baseDomain.includes('localhost') ? 'http' : 'https');

  return {
    urlStyle: tenant.urlStyle ?? 'path',
    effective: effective.mode,
    allowed: effective.allowed,
    canonicalBase: effective.canonicalBase,
    reason: effective.reason,
    customDomain: branding?.customDomain ?? null,
    status: branding?.customDomainStatus ?? null,
    verifiedAt: branding?.customDomainVerifiedAt ?? null,
    instructions: {
      txtRecord: branding?.customDomain
        ? `_saas-verify.${branding.customDomain} = saas-verify=${tenant.id}`
        : null,
      cnameTarget: env.CUSTOM_DOMAIN_CNAME_TARGET,
    },
    urls: {
      path: `${protocol}://${baseDomain}/w/${tenant.slug}`,
      subdomain: effective.allowed.subdomain
        ? `${protocol}://${tenant.slug}.${baseDomain}`
        : undefined,
      customDomain: branding?.customDomain ? `https://${branding.customDomain}` : undefined,
    },
  };
}

export async function updateTenantUrlSettings(
  tenantId: string,
  operatorUserId: string,
  data: UpdateTenantUrlSettingsDto,
) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const entitlements = await billingService.getTenantEntitlements(tenantId);
  const existingBranding = await tenantBrandingRepo.findBrandingByTenantId(tenantId);

  // 1. Validate customDomain if changed
  if (data.customDomain !== undefined) {
    if (data.customDomain && data.customDomain.trim() !== '') {
      if (!entitlements.limits?.urlAccess?.customDomain) {
        throw new AppError(
          403,
          'Custom domain feature is not available on your plan. Upgrade to Enterprise to configure custom domains.',
          'PLAN_FEATURE_UNAVAILABLE',
          { feature: 'urlAccess.customDomain', requiredPlan: 'ENTERPRISE' },
        );
      }

      const cleanDomain = data.customDomain.toLowerCase().trim();
      const baseDomain = env.APP_BASE_DOMAIN.toLowerCase().split(':')[0] ?? 'localhost';
      if (cleanDomain === baseDomain || cleanDomain.endsWith(`.${baseDomain}`)) {
        throw new AppError(
          400,
          'Custom domain cannot end with the platform base domain',
          'DOMAIN_RESERVED',
        );
      }

      const existingByDomain = await tenantBrandingRepo.findBrandingByCustomDomain(cleanDomain);
      if (existingByDomain && existingByDomain.tenantId !== tenantId) {
        throw new AppError(
          409,
          'This custom domain is already registered to another workspace',
          'DOMAIN_ALREADY_IN_USE',
        );
      }

      if (cleanDomain !== existingBranding?.customDomain?.toLowerCase()) {
        if (existingBranding?.customDomain) {
          await removeCorsCustomDomain(existingBranding.customDomain);
        }
        await tenantBrandingRepo.updateCustomDomain(tenantId, cleanDomain);
        await tenantBrandingRepo.updateCustomDomainStatus(tenantId, 'PENDING', null, 'PENDING');
      }
    } else {
      if (existingBranding?.customDomain) {
        await removeCorsCustomDomain(existingBranding.customDomain);
      }
      await tenantBrandingRepo.updateCustomDomain(tenantId, null);
      await tenantBrandingRepo.updateCustomDomainStatus(tenantId, 'PENDING', null, null);
      if (tenant.urlStyle === 'customDomain') {
        await tenantsRepo.updateTenantUrlStyle(tenantId, 'path');
      }
    }
  }

  // 2. Validate urlStyle if changed
  if (data.urlStyle !== undefined) {
    if (data.urlStyle === 'subdomain' && !entitlements.limits?.urlAccess?.subdomain) {
      throw new AppError(
        403,
        'Subdomain URLs are not available on your current plan. Upgrade to Pro or Enterprise.',
        'PLAN_FEATURE_UNAVAILABLE',
        { feature: 'urlAccess.subdomain', requiredPlan: 'PRO' },
      );
    }
    if (data.urlStyle === 'customDomain' && !entitlements.limits?.urlAccess?.customDomain) {
      throw new AppError(
        403,
        'Custom domain URLs are not available on your current plan. Upgrade to Enterprise.',
        'PLAN_FEATURE_UNAVAILABLE',
        { feature: 'urlAccess.customDomain', requiredPlan: 'ENTERPRISE' },
      );
    }
    await tenantsRepo.updateTenantUrlStyle(tenantId, data.urlStyle);
  }

  await cache.delByPrefix('branding:resolve:');
  await cache.delByPrefix(`tenant:url:${tenantId}`);
  await cache.del(`entitlements:${tenantId}`);

  await logSecurityEvent({
    tenantId,
    userId: operatorUserId,
    action: 'TENANT.URL_SETTINGS_UPDATED',
    entityType: 'Tenant',
    entityId: tenantId,
    metadata: {
      urlStyle: data.urlStyle,
      customDomain: data.customDomain,
    },
  });

  return getTenantUrlSettings(tenantId);
}

export async function deleteTenantCustomDomain(tenantId: string, operatorUserId: string) {
  return updateTenantUrlSettings(tenantId, operatorUserId, {
    customDomain: null,
    urlStyle: 'path',
  });
}

export async function overrideTenantUrlSettings(
  tenantId: string,
  staffId: string,
  data: OverrideTenantCustomDomainDto & { urlStyle?: 'path' | 'subdomain' | 'customDomain' },
) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const existingBranding = await tenantBrandingRepo.findBrandingByTenantId(tenantId);

  if (data.customDomain !== undefined) {
    const cleanDomain = data.customDomain?.toLowerCase().trim() || null;
    if (cleanDomain && cleanDomain !== existingBranding?.customDomain?.toLowerCase()) {
      if (existingBranding?.customDomain) {
        await removeCorsCustomDomain(existingBranding.customDomain);
      }
      await tenantBrandingRepo.updateCustomDomain(tenantId, cleanDomain);
    }
  }

  const status = data.status ?? 'VERIFIED';
  const verifiedAt = status === 'VERIFIED' ? new Date() : null;
  const tlsStatus = status === 'VERIFIED' ? 'ISSUED' : 'PENDING';
  await tenantBrandingRepo.updateCustomDomainStatus(tenantId, status, verifiedAt, tlsStatus);

  const updatedBranding = await tenantBrandingRepo.findBrandingByTenantId(tenantId);
  if (status === 'VERIFIED' && updatedBranding?.customDomain) {
    await addCorsCustomDomain(updatedBranding.customDomain);
  } else if (status !== 'VERIFIED' && updatedBranding?.customDomain) {
    await removeCorsCustomDomain(updatedBranding.customDomain);
  }

  if (data.urlStyle) {
    await tenantsRepo.updateTenantUrlStyle(tenantId, data.urlStyle);
  }

  await cache.delByPrefix('branding:resolve:');
  await cache.delByPrefix(`tenant:url:${tenantId}`);
  await cache.del(`entitlements:${tenantId}`);

  await auditRepo.createAuditLog({
    tenantId,
    action: 'PLATFORM.TENANT_URL_SETTINGS_OVERRIDE',
    entityType: 'Tenant',
    entityId: tenantId,
    actorType: 'PLATFORM_STAFF',
    actorStaffId: staffId,
    metadata: {
      customDomain: updatedBranding?.customDomain,
      status,
      urlStyle: data.urlStyle,
      reason: data.reason,
    },
  });

  return getTenantUrlSettings(tenantId);
}
