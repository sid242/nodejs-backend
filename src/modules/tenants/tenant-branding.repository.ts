import { eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { tenantBrandings, type NewTenantBranding, type TenantBranding } from '@/db/schema/index';

export async function findBrandingByTenantId(tenantId: string): Promise<TenantBranding | null> {
  const [record] = await db
    .select()
    .from(tenantBrandings)
    .where(eq(tenantBrandings.tenantId, tenantId))
    .limit(1);
  return record ?? null;
}

export async function findBrandingByCustomDomain(domain: string): Promise<TenantBranding | null> {
  const [record] = await db
    .select()
    .from(tenantBrandings)
    .where(eq(tenantBrandings.customDomain, domain.toLowerCase()))
    .limit(1);
  return record ?? null;
}

export async function upsertTenantBranding(data: NewTenantBranding): Promise<TenantBranding> {
  const [record] = await db
    .insert(tenantBrandings)
    .values(data)
    .onConflictDoUpdate({
      target: tenantBrandings.tenantId,
      set: {
        companyName: data?.companyName ?? null,
        logoUrl: data?.logoUrl ?? null,
        logoDarkUrl: data?.logoDarkUrl ?? null,
        faviconUrl: data?.faviconUrl ?? null,
        primaryColor: data?.primaryColor ?? '#4F46E5',
        accentColor: data?.accentColor ?? '#06B6D4',
        borderRadius: data?.borderRadius ?? '0.5rem',
        customDomain: data?.customDomain ? data.customDomain.toLowerCase() : null,
        customDomainStatus: data?.customDomainStatus ?? 'PENDING',
        customDomainVerifiedAt: data?.customDomainVerifiedAt ?? null,
        customDomainTlsStatus: data?.customDomainTlsStatus ?? null,
        supportEmail: data?.supportEmail ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return record!;
}

export async function deleteTenantBranding(tenantId: string): Promise<boolean> {
  const [deleted] = await db
    .delete(tenantBrandings)
    .where(eq(tenantBrandings.tenantId, tenantId))
    .returning();
  return !!deleted;
}

export async function updateCustomDomainStatus(
  tenantId: string,
  status: 'PENDING' | 'VERIFIED' | 'FAILED',
  verifiedAt?: Date | null,
  tlsStatus?: string | null,
): Promise<TenantBranding | null> {
  const [updated] = await db
    .update(tenantBrandings)
    .set({
      customDomainStatus: status,
      ...(verifiedAt !== undefined ? { customDomainVerifiedAt: verifiedAt } : {}),
      ...(tlsStatus !== undefined ? { customDomainTlsStatus: tlsStatus } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tenantBrandings.tenantId, tenantId))
    .returning();
  return updated ?? null;
}

export async function updateCustomDomain(
  tenantId: string,
  domain: string | null,
): Promise<TenantBranding | null> {
  const [updated] = await db
    .update(tenantBrandings)
    .set({
      customDomain: domain ? domain.toLowerCase() : null,
      customDomainStatus: 'PENDING',
      customDomainVerifiedAt: null,
      customDomainTlsStatus: null,
      updatedAt: new Date(),
    })
    .where(eq(tenantBrandings.tenantId, tenantId))
    .returning();
  return updated ?? null;
}

export const tenantBrandingRepo = {
  findBrandingByTenantId,
  findBrandingByCustomDomain,
  upsertTenantBranding,
  updateCustomDomainStatus,
  updateCustomDomain,
  deleteTenantBranding,
};
