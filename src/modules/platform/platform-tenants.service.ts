import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { logger } from '@/config/logger';
import { appModules, tenantBrandings, tenantModules } from '@/db/schema';
import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import { provisionDedicatedDatabase } from '@/lib/provision-db';
import { getSecretStore } from '@/lib/secrets';
import * as authRepo from '@/modules/auth/auth.repository';
import { createMagicLinkToken } from '@/modules/auth/tokens';
import * as billingService from '@/modules/billing/billing.service';
import { rbacRepo } from '@/modules/rbac/rbac.repository';
import * as rbacService from '@/modules/rbac/rbac.service';
import { buildTenantUrl } from '@/modules/tenants/tenant-url.service';
import { tenantsRepo } from '@/modules/tenants/tenants.repository';
import { emailQueue } from '@/queues/index';

import {
  provisionTenantDto,
  type ListPlatformTenantsQueryDto,
  type ProvisionTenantInput,
  type UpdatePlatformTenantDto,
  type UpdatePlatformTenantSubscriptionDto,
} from './platform.dto';
import * as platformRepo from './platform.repository';

export async function listTenants(filters: ListPlatformTenantsQueryDto) {
  return platformRepo.findTenantsPaginated(filters);
}

export async function getTenantById(id: string) {
  const tenant = await platformRepo.findTenantDetailById(id);
  if (!tenant) throw AppError.notFound('Tenant organization not found');
  return tenant;
}

export async function provisionTenant(
  actorStaffId: string,
  rawInput: ProvisionTenantInput,
  requestId?: string,
) {
  const data = provisionTenantDto.parse(rawInput);
  const normalizedSlug = data.slug.toLowerCase().trim();
  const existing = await tenantsRepo.findTenantBySlug(normalizedSlug);
  if (existing) {
    throw AppError.conflict(`A workspace with slug "${normalizedSlug}" already exists`);
  }

  const isDedicated = data.databaseMode === 'dedicated';
  const tenantId = randomUUID();
  const configuredDatabaseKey = data.databaseConfig?.databaseKey?.trim();
  const databaseKey = isDedicated ? configuredDatabaseKey || `dedicated-${tenantId}` : 'primary';

  const trialEndsAt = data?.trialDays
    ? new Date(Date.now() + data.trialDays * 24 * 3600 * 1000)
    : null;

  // 1. Create tenant organization record in PENDING/PROVISIONING state
  const tenant = await tenantsRepo.createTenant({
    id: tenantId,
    name: data.name.trim(),
    slug: normalizedSlug,
    legalName: data.legalName?.trim() ?? null,
    tenantCode: data.tenantCode?.trim() ?? null,
    country: data.country?.trim() ?? null,
    region: data.region?.trim() ?? null,
    timezone: data.timezone ?? 'UTC',
    locale: data.locale ?? 'en-US',
    currency: data.currency ?? 'USD',
    supportEmail: data.supportEmail?.trim() ?? null,
    supportPhone: data.supportPhone?.trim() ?? null,
    billingEmail: data.billingEmail?.trim() ?? null,
    internalNote: data.internalNote?.trim() ?? null,
    plan: isDedicated ? 'ENTERPRISE' : (data.plan ?? 'FREE'),
    status: 'ACTIVE',
    provisioningStatus: 'PROVISIONING',
    provisioningStep: 'STORAGE',
    trialEndsAt,
    databaseMode: isDedicated ? 'dedicated' : 'shared',
    databaseKey,
    metadata: {
      notes: data?.notes ?? null,
      provisionedByStaffId: actorStaffId,
    },
  });

  // Automatically provision dedicated database and execute Drizzle migrations
  if (isDedicated) {
    try {
      const dbResult = await provisionDedicatedDatabase(tenant.id, {
        customDatabaseName: data.databaseConfig?.databaseName,
        customDatabaseKey: databaseKey,
        poolLimit: data.databaseConfig?.poolLimit,
        connectionUrl: data.databaseConfig?.connectionUrl,
      });

      let databaseSecretRef: string | null = null;
      if (data.databaseConfig?.connectionUrl) {
        const secretStore = getSecretStore();
        databaseSecretRef = await secretStore.put(
          'db-connection-url',
          data.databaseConfig.connectionUrl,
          tenant.id,
        );
      }

      await tenantsRepo.updateTenant(tenant.id, {
        databaseKey: dbResult.databaseKey,
        databaseSecretRef,
        metadata: {
          ...(tenant.metadata as Record<string, unknown> | null),
          databaseName: dbResult.databaseName,
          poolLimit: dbResult.poolLimit,
          schemaVersion: dbResult.schemaVersion,
          dbProvisionedAt: new Date().toISOString(),
        },
      });
    } catch (err: unknown) {
      logger.error({ err, tenantId: tenant.id }, 'Failed to provision dedicated database cluster');
      const errorMessage = (err as Error)?.message ?? 'Unknown database provisioning error';
      await tenantsRepo.updateTenant(tenant.id, {
        provisioningStatus: 'FAILED',
        provisioningStep: 'STORAGE',
        provisioningError: errorMessage,
        metadata: {
          ...(tenant.metadata as Record<string, unknown> | null),
          dbProvisioningError: errorMessage,
        },
      });
      throw AppError.internal(`Failed to provision storage for dedicated tenant: ${errorMessage}`);
    }
  }

  // 2. Progress to SEEDS step
  await tenantsRepo.updateTenant(tenant.id, { provisioningStep: 'SEEDS' });

  // Resolve or provision owner user account
  const normalizedEmail = data.ownerEmail.toLowerCase().trim();
  let ownerUser = await authRepo.findByEmail(normalizedEmail);
  let isNewUser = false;

  if (!ownerUser) {
    const dummyHash = await bcrypt.hash(randomUUID(), 12);
    const defaultNamePart = normalizedEmail.split('@')[0] || 'Owner';
    const firstName =
      data.ownerFirstName?.trim() ||
      defaultNamePart.charAt(0).toUpperCase() + defaultNamePart.slice(1);
    const lastName = data.ownerLastName?.trim() || 'Owner';

    const created = await authRepo.createUser({
      email: normalizedEmail,
      firstName,
      lastName,
      passwordHash: dummyHash,
    });
    ownerUser = await authRepo.findById(created.id);
    isNewUser = true;
  }

  if (!ownerUser) {
    throw AppError.internal('Failed to provision owner account for new workspace');
  }

  // 3. Add owner as invited tenant member
  const member = await tenantsRepo.addTenantMember({
    tenantId: tenant.id,
    userId: ownerUser.id,
    status: 'INVITED',
  });

  // 4. Look up or seed OWNER system role
  const systemRoles = await rbacRepo.findRolesByTenant(null);
  let ownerRole = systemRoles.find((r) => r.name === rbacService.SYSTEM_ROLES.OWNER);

  if (!ownerRole) {
    await rbacService.seedDefaultRbac();
    const refreshed = await rbacRepo.findRolesByTenant(null);
    ownerRole = refreshed.find((r) => r.name === rbacService.SYSTEM_ROLES.OWNER);
  }

  if (ownerRole) {
    await rbacRepo.assignRoleToMember(member.id, ownerRole.id);
  }

  // 5. Provision default tenant modules
  const allModules = await db
    .select({ id: appModules.id })
    .from(appModules)
    .where(eq(appModules.isSystem, true));
  if (allModules.length > 0) {
    await db
      .insert(tenantModules)
      .values(
        allModules.map((m) => ({
          tenantId: tenant.id,
          moduleId: m.id,
          isEnabled: true,
        })),
      )
      .onConflictDoNothing();
  }

  // 6. Assign initial subscription
  await billingService.assignInitialSubscription(tenant.id, tenant.plan ?? 'FREE');

  // 7. Seed branding record (with optional custom wizard inputs)
  await db
    .insert(tenantBrandings)
    .values({
      tenantId: tenant.id,
      companyName: data.branding?.displayName?.trim() || tenant.name,
      logoUrl: data.branding?.logoUrl || null,
      faviconUrl: data.branding?.faviconUrl || null,
      primaryColor: data.branding?.primaryColor || '#4F46E5',
      secondaryColor: data.branding?.secondaryColor || null,
      accentColor: '#06B6D4',
      borderRadius: '0.5rem',
      customDomainStatus: 'PENDING',
    })
    .onConflictDoNothing();

  // 8. Progress to INVITATION step & generate 48-hour invitation token
  await tenantsRepo.updateTenant(tenant.id, { provisioningStep: 'INVITATION' });

  const inviteToken = await createMagicLinkToken(ownerUser.id, 48 * 3600, tenant.id);
  const inviteUrl = await buildTenantUrl(
    tenant.id,
    `/accept-invite?token=${inviteToken}&tenant=${tenant.id}`,
  );

  const ownerDisplayName =
    [ownerUser.firstName, ownerUser.lastName].filter(Boolean).join(' ') || 'Owner';

  await emailQueue.add(
    'tenant-invite',
    {
      to: ownerUser.email,
      name: ownerDisplayName,
      tenantName: tenant.name,
      roleName: 'Owner',
      token: inviteToken,
      inviteUrl,
      tenantId: tenant.id,
    },
    { jobId: `provision-${tenant.id}-${ownerUser.id}-${Date.now()}` },
  );

  // 9. Mark provisioning successfully completed
  const completedTenant = await tenantsRepo.updateTenant(tenant.id, {
    provisioningStatus: 'ACTIVE',
    provisioningStep: 'COMPLETED',
    provisioningError: null,
  });

  // 10. Write immutable platform audit log
  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.provisioned',
    targetType: 'tenant',
    targetId: tenant.id,
    tenantId: tenant.id,
    metadata: {
      name: tenant.name,
      slug: tenant.slug,
      legalName: tenant.legalName,
      tenantCode: tenant.tenantCode,
      ownerEmail: normalizedEmail,
      plan: tenant.plan,
      isNewUser,
      databaseMode: tenant.databaseMode,
    },
    requestId,
  });

  return {
    tenant: completedTenant ?? tenant,
    owner: {
      id: ownerUser.id,
      email: ownerUser.email,
      firstName: ownerUser.firstName,
      lastName: ownerUser.lastName,
      name: ownerDisplayName,
      isNewUser,
    },
    inviteUrl,
    inviteToken,
  };
}

export async function retryTenantProvisioning(
  actorStaffId: string,
  tenantId: string,
  reason?: string,
  requestId?: string,
) {
  const tenant = await platformRepo.findTenantDetailById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  if (tenant.provisioningStatus === 'ACTIVE' && tenant.status === 'ACTIVE') {
    throw AppError.badRequest('Tenant provisioning is already active and complete');
  }

  // Step 1: Set to PROVISIONING / STORAGE
  await tenantsRepo.updateTenant(tenantId, {
    provisioningStatus: 'PROVISIONING',
    provisioningStep: 'STORAGE',
    provisioningError: null,
  });

  const isDedicated = tenant.databaseMode === 'dedicated';

  // Step 2: Storage & Migrations (Dedicated if applicable)
  if (isDedicated) {
    try {
      const dbResult = await provisionDedicatedDatabase(tenant.id, {
        customDatabaseKey: tenant.databaseKey || undefined,
      });

      await tenantsRepo.updateTenant(tenant.id, {
        databaseKey: dbResult.databaseKey,
        metadata: {
          ...(tenant.metadata as Record<string, unknown> | null),
          databaseName: dbResult.databaseName,
          poolLimit: dbResult.poolLimit,
          schemaVersion: dbResult.schemaVersion,
          dbProvisionedAt: new Date().toISOString(),
        },
      });
    } catch (err: unknown) {
      const errorMsg = (err as Error)?.message ?? 'Storage provisioning error';
      await tenantsRepo.updateTenant(tenant.id, {
        provisioningStatus: 'FAILED',
        provisioningStep: 'STORAGE',
        provisioningError: errorMsg,
      });
      throw AppError.internal(`Dedicated database retry failed: ${errorMsg}`);
    }
  }

  // Step 3: Seed Defaults (Roles, Modules, Subscription, Branding)
  await tenantsRepo.updateTenant(tenant.id, { provisioningStep: 'SEEDS' });

  // Ensure system roles
  const systemRoles = await rbacRepo.findRolesByTenant(null);
  const ownerRole = systemRoles.find((r) => r.name === rbacService.SYSTEM_ROLES.OWNER);
  if (!ownerRole) {
    await rbacService.seedDefaultRbac();
  }

  // Ensure default modules
  const allModules = await db
    .select({ id: appModules.id })
    .from(appModules)
    .where(eq(appModules.isSystem, true));
  if (allModules.length > 0) {
    await db
      .insert(tenantModules)
      .values(
        allModules.map((m) => ({
          tenantId: tenant.id,
          moduleId: m.id,
          isEnabled: true,
        })),
      )
      .onConflictDoNothing();
  }

  // Ensure subscription exists
  const existingSub = await platformRepo.findSubscriptionByTenantId(tenant.id);
  if (!existingSub) {
    await billingService.assignInitialSubscription(tenant.id, tenant.plan ?? 'FREE');
  }

  // Ensure branding exists
  const existingBranding = await db
    .select({ id: tenantBrandings.id })
    .from(tenantBrandings)
    .where(eq(tenantBrandings.tenantId, tenant.id))
    .limit(1);
  if (!existingBranding[0]) {
    await db
      .insert(tenantBrandings)
      .values({
        tenantId: tenant.id,
        companyName: tenant.name,
        primaryColor: '#4F46E5',
        accentColor: '#06B6D4',
        borderRadius: '0.5rem',
        customDomainStatus: 'PENDING',
      })
      .onConflictDoNothing();
  }

  // Step 4: Owner membership & invite
  await tenantsRepo.updateTenant(tenant.id, { provisioningStep: 'OWNER' });
  const members = await platformRepo.findTenantMembers(tenant.id);
  const existingOwnerMember = members.find((m) => m.roleName.toLowerCase() === 'owner');

  let inviteToken: string | undefined;
  let inviteUrl: string | undefined;

  if (existingOwnerMember && existingOwnerMember.status === 'INVITED') {
    inviteToken = await createMagicLinkToken(existingOwnerMember.userId, 48 * 3600, tenant.id);
    inviteUrl = await buildTenantUrl(
      tenant.id,
      `/accept-invite?token=${inviteToken}&tenant=${tenant.id}`,
    );
    const memberDisplayName =
      [existingOwnerMember.firstName, existingOwnerMember.lastName].filter(Boolean).join(' ') ||
      'Owner';
    await emailQueue.add(
      'tenant-invite',
      {
        to: existingOwnerMember.email,
        name: memberDisplayName,
        tenantName: tenant.name,
        roleName: 'Owner',
        token: inviteToken,
        inviteUrl,
        tenantId: tenant.id,
      },
      { jobId: `retry-provision-${tenant.id}-${existingOwnerMember.userId}-${Date.now()}` },
    );
  }

  // Step 5: Mark complete
  const finalTenant = await tenantsRepo.updateTenant(tenant.id, {
    status: 'ACTIVE',
    provisioningStatus: 'ACTIVE',
    provisioningStep: 'COMPLETED',
    provisioningError: null,
  });

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.provisioning_retried',
    targetType: 'tenant',
    targetId: tenant.id,
    tenantId: tenant.id,
    metadata: { reason, previousStep: tenant.provisioningStep },
    requestId,
  });

  return {
    tenant: finalTenant,
    inviteUrl,
    inviteToken,
  };
}

export async function closeTenant(
  actorStaffId: string,
  tenantId: string,
  reason: string,
  requestId?: string,
) {
  const existing = await platformRepo.findTenantDetailById(tenantId);
  if (!existing) throw AppError.notFound('Tenant not found');

  if (existing.status === 'DEACTIVATED') {
    throw AppError.badRequest('Tenant organization is already closed');
  }

  const existingNote = existing.internalNote || '';
  const closureNote = `[Closed at ${new Date().toISOString()}] Reason: ${reason}`;
  const internalNote = existingNote ? `${existingNote}\n${closureNote}` : closureNote;

  const updated = await platformRepo.updateTenantPlatformFields(tenantId, {
    status: 'DEACTIVATED',
    provisioningStatus: 'DEACTIVATED',
    deletedAt: new Date(),
    internalNote,
  });

  await cache.delByPrefix(`tenant:${tenantId}`);

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.closed',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    metadata: { reason, previousStatus: existing.status },
    requestId,
  });

  return updated;
}

export async function updateTenant(
  actorStaffId: string,
  id: string,
  data: UpdatePlatformTenantDto,
  requestId?: string,
) {
  const existing = await platformRepo.findTenantDetailById(id);
  if (!existing) throw AppError.notFound('Tenant not found');

  const updated = await platformRepo.updateTenantPlatformFields(id, {
    ...(data?.name !== undefined ? { name: data.name.trim() } : {}),
    ...(data?.legalName !== undefined ? { legalName: data.legalName?.trim() ?? null } : {}),
    ...(data?.tenantCode !== undefined ? { tenantCode: data.tenantCode?.trim() ?? null } : {}),
    ...(data?.country !== undefined ? { country: data.country?.trim() ?? null } : {}),
    ...(data?.region !== undefined ? { region: data.region?.trim() ?? null } : {}),
    ...(data?.timezone !== undefined ? { timezone: data.timezone } : {}),
    ...(data?.locale !== undefined ? { locale: data.locale } : {}),
    ...(data?.currency !== undefined ? { currency: data.currency } : {}),
    ...(data?.supportEmail !== undefined
      ? { supportEmail: data.supportEmail?.trim() ?? null }
      : {}),
    ...(data?.supportPhone !== undefined
      ? { supportPhone: data.supportPhone?.trim() ?? null }
      : {}),
    ...(data?.billingEmail !== undefined
      ? { billingEmail: data.billingEmail?.trim() ?? null }
      : {}),
    ...(data?.internalNote !== undefined
      ? { internalNote: data.internalNote?.trim() ?? null }
      : {}),
    ...(data?.plan !== undefined ? { plan: data.plan } : {}),
    ...(data?.databaseMode !== undefined ? { databaseMode: data.databaseMode } : {}),
    ...(data?.trialEndsAt !== undefined
      ? { trialEndsAt: data.trialEndsAt ? new Date(data.trialEndsAt) : null }
      : {}),
    ...(data?.notes !== undefined
      ? {
          metadata: {
            ...(typeof existing.metadata === 'object' && existing.metadata
              ? existing.metadata
              : {}),
            notes: data.notes,
          },
        }
      : {}),
  });

  if (!updated) throw AppError.notFound('Failed to update tenant');

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.updated',
    targetType: 'tenant',
    targetId: id,
    tenantId: id,
    metadata: { changes: data },
    requestId,
  });

  return updated;
}

export async function suspendTenant(
  actorStaffId: string,
  id: string,
  reason: string,
  requestId?: string,
) {
  const existing = await platformRepo.findTenantDetailById(id);
  if (!existing) throw AppError.notFound('Tenant not found');

  if (existing.status === 'SUSPENDED') {
    throw AppError.badRequest('Tenant organization is already suspended');
  }

  const updated = await platformRepo.updateTenantPlatformFields(id, {
    status: 'SUSPENDED',
  });

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.suspended',
    targetType: 'tenant',
    targetId: id,
    tenantId: id,
    metadata: { reason, previousStatus: existing.status },
    requestId,
  });

  return updated;
}

export async function activateTenant(
  actorStaffId: string,
  id: string,
  reason?: string,
  requestId?: string,
) {
  const existing = await platformRepo.findTenantDetailById(id);
  if (!existing) throw AppError.notFound('Tenant not found');

  if (existing.status === 'ACTIVE') {
    throw AppError.badRequest('Tenant organization is already active');
  }

  const updated = await platformRepo.updateTenantPlatformFields(id, {
    status: 'ACTIVE',
  });

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.activated',
    targetType: 'tenant',
    targetId: id,
    tenantId: id,
    metadata: { reason, previousStatus: existing.status },
    requestId,
  });

  return updated;
}

export async function getTenantSubscription(tenantId: string) {
  const subscription = await platformRepo.findSubscriptionByTenantId(tenantId);
  if (!subscription) throw AppError.notFound('No subscription record found for this tenant');
  return subscription;
}

export async function updateTenantSubscription(
  actorStaffId: string,
  tenantId: string,
  data: UpdatePlatformTenantSubscriptionDto,
  requestId?: string,
) {
  const existing = await platformRepo.findSubscriptionByTenantId(tenantId);
  if (!existing) throw AppError.notFound('No subscription record found for this tenant');

  const updated = await platformRepo.updateTenantSubscription(tenantId, {
    ...(data?.planId ? { planId: data.planId } : {}),
    ...(data?.seatCount !== undefined ? { seatCount: data.seatCount } : {}),
    ...(data?.status ? { status: data.status } : {}),
    ...(data?.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: data.cancelAtPeriodEnd } : {}),
    ...(data?.currentPeriodEnd ? { currentPeriodEnd: new Date(data.currentPeriodEnd) } : {}),
  });

  if (!updated) throw AppError.notFound('Failed to update tenant subscription');

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'tenant.subscription_updated',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    metadata: { changes: data },
    requestId,
  });

  return updated;
}

// ==========================================
// 8. Tenant Database Routing & Lifecycle Management
// ==========================================
