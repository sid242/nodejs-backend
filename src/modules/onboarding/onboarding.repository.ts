import { and, count, eq, gt } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { tenantDb } from '@/db/tenancy/context';

export async function getStoredProgress(tenantId: string) {
  return tenantDb()
    .select()
    .from(schema.onboardingProgress)
    .where(eq(schema.onboardingProgress.tenantId, tenantId));
}

export async function upsertStepProgress(
  tenantId: string,
  stepKey: string,
  status: 'COMPLETED' | 'SKIPPED',
  data?: Record<string, unknown>,
  userId?: string,
) {
  const [row] = await tenantDb()
    .insert(schema.onboardingProgress)
    .values({
      tenantId,
      stepKey,
      status,
      completedAt: status === 'COMPLETED' ? new Date() : null,
      data: data ?? {},
      userId: userId ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.onboardingProgress.tenantId, schema.onboardingProgress.stepKey],
      set: {
        status,
        completedAt: status === 'COMPLETED' ? new Date() : null,
        data: data ?? {},
        userId: userId ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row;
}

export async function checkSystemActivationSignals(tenantId: string) {
  const db = tenantDb();

  // 1. Check member invites (more than 1 member in tenant)
  const [memberRes] = await db
    .select({ count: count() })
    .from(schema.tenantMembers)
    .where(eq(schema.tenantMembers.tenantId, tenantId));

  // 2. Check custom branding
  const [brandingRes] = await db
    .select()
    .from(schema.tenantBrandings)
    .where(eq(schema.tenantBrandings.tenantId, tenantId))
    .limit(1);

  // 3. Check custom roles created
  const [rolesRes] = await db
    .select({ count: count() })
    .from(schema.roles)
    .where(eq(schema.roles.tenantId, tenantId));

  // 4. Check file uploaded
  const [filesRes] = await db
    .select({ count: count() })
    .from(schema.files)
    .where(and(eq(schema.files.tenantId, tenantId), eq(schema.files.status, 'UPLOADED')));

  // 5. Check SMTP config
  const [emailConfigRes] = await db
    .select()
    .from(schema.tenantEmailConfigs)
    .where(eq(schema.tenantEmailConfigs.tenantId, tenantId))
    .limit(1);

  // 6. Check SSO config
  const [ssoRes] = await db
    .select()
    .from(schema.tenantSsoConfigs)
    .where(eq(schema.tenantSsoConfigs.tenantId, tenantId))
    .limit(1);

  return {
    hasInvitedMembers: (memberRes?.count ?? 0) > 1,
    hasBranding: Boolean(brandingRes?.logoUrl || brandingRes?.primaryColor),
    hasCustomRoles: (rolesRes?.count ?? 0) > 3, // default roles: OWNER, ADMIN, MEMBER
    hasUploadedFiles: (filesRes?.count ?? 0) > 0,
    hasConfiguredSmtp: Boolean(emailConfigRes?.host),
    hasConfiguredSso: Boolean(ssoRes?.status === 'ACTIVE'),
  };
}
