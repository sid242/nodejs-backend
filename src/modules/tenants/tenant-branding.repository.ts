import { eq } from 'drizzle-orm';
import { db } from '@/config/db.js';
import { tenantBrandings, type TenantBranding, type NewTenantBranding } from '@/db/schema/index.js';

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

export const tenantBrandingRepo = {
  findBrandingByTenantId,
  findBrandingByCustomDomain,
  upsertTenantBranding,
  deleteTenantBranding,
};
