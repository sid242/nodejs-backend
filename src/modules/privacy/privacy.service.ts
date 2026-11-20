import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, desc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import { logger } from '@/config/logger';
import * as schema from '@/db/schema';
import {
  accountDeletionRequests,
  auditLogs,
  consentRecords,
  dataExportRequests,
  emailMessages,
  files,
  legalDocuments,
  notifications,
  tenantLegalHolds,
  tenants,
  users,
  webhookDeliveries,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { createDownloadUrl, putObject } from '@/lib/s3';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import { maintenanceQueue } from '@/queues/index';

import * as privacyRepo from './privacy.repository';

// -----------------------------------------------------------------------------
// User Data Export (DSAR)
// -----------------------------------------------------------------------------

export async function requestUserDataExport(
  userId: string,
  ip?: string,
  userAgent?: string,
) {
  const recent = await privacyRepo.getRecentUserDataExport(userId, 24);
  if (recent) {
    throw AppError.badRequest(
      'A data export request was already submitted in the last 24 hours. Please wait before requesting another.',
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw AppError.notFound('User not found');
  }

  const request = await privacyRepo.createDataExportRequest({
    userId,
    scope: 'USER',
    status: 'PENDING',
  });

  if (!request) {
    throw AppError.internal('Failed to create data export request');
  }

  try {
    await maintenanceQueue.add(
      'export-user-data',
      { requestId: request.id, userId },
      { removeOnComplete: true },
    );
  } catch (err) {
    logger.warn({ err, requestId: request.id }, 'Could not enqueue export-user-data job, running inline fallback');
    processUserDataExport(request.id, userId).catch((processErr) => {
      logger.error({ processErr, requestId: request.id }, 'Inline user export fallback failed');
    });
  }

  await logSecurityEvent({
    userId,
    actorUserId: userId,
    actorType: 'USER',
    action: 'privacy:data_export_requested',
    resourceType: 'DataExportRequest',
    resourceId: request.id,
    ipAddress: ip,
    userAgent,
    metadata: { scope: 'USER' },
  });

  return request;
}

export async function processUserDataExport(requestId: string, userId: string) {
  logger.info({ requestId, userId }, 'Processing user data export');

  await privacyRepo.updateDataExportRequest(requestId, {
    status: 'PROCESSING',
  });

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const safeUserProfile = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      locale: user.locale,
      timezone: user.timezone,
      dateFormat: user.dateFormat,
      authMethod: user.authMethod,
      termsAcceptedAt: user.termsAcceptedAt,
      termsVersion: user.termsVersion,
      marketingOptIn: user.marketingOptIn,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
    };

    // 2. Memberships
    const memberships = await db
      .select({
        id: schema.tenantMembers.id,
        tenantId: schema.tenantMembers.tenantId,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        status: schema.tenantMembers.status,
        joinedAt: schema.tenantMembers.joinedAt,
      })
      .from(schema.tenantMembers)
      .innerJoin(tenants, eq(schema.tenantMembers.tenantId, tenants.id))
      .where(eq(schema.tenantMembers.userId, userId));

    // 3. Addresses
    const addresses = await db
      .select()
      .from(schema.addresses)
      .where(and(eq(schema.addresses.ownerId, userId), eq(schema.addresses.ownerType, 'USER')));

    // 4. Login events
    const loginHistory = await db
      .select({
        id: schema.userLoginEvents.id,
        result: schema.userLoginEvents.result,
        method: schema.userLoginEvents.method,
        ip: schema.userLoginEvents.ip,
        userAgent: schema.userLoginEvents.userAgent,
        country: schema.userLoginEvents.country,
        city: schema.userLoginEvents.city,
        createdAt: schema.userLoginEvents.createdAt,
      })
      .from(schema.userLoginEvents)
      .where(eq(schema.userLoginEvents.userId, userId))
      .orderBy(desc(schema.userLoginEvents.createdAt))
      .limit(100);

    // 5. Files metadata uploaded by user
    const userFiles = await db
      .select({
        id: files.id,
        filename: files.filename,
        contentType: files.contentType,
        size: files.size,
        status: files.status,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(eq(files.ownerId, userId))
      .orderBy(desc(files.createdAt))
      .limit(200);

    // 6. Consents
    const consents = await privacyRepo.getUserConsentRecords(userId);

    // 7. Audit log excerpts where user is actor
    const auditEntries = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        result: auditLogs.result,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(eq(auditLogs.actorUserId, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);

    const payload = {
      exportId: requestId,
      exportedAt: new Date().toISOString(),
      user: safeUserProfile,
      memberships,
      addresses,
      loginHistory,
      filesMetadata: userFiles,
      consentRecords: consents,
      auditHistory: auditEntries,
    };

    const payloadJson = JSON.stringify(payload, null, 2);
    const fileKey = `data-exports/user/${userId}/${requestId}.json`;
    const fileSizeBytes = Buffer.byteLength(payloadJson, 'utf-8');

    // Upload to S3
    await putObject(fileKey, payloadJson, 'application/json', {
      userId,
      requestId,
      scope: 'USER',
    });

    // Generate signed download link (24 hours)
    const downloadUrl = await createDownloadUrl(fileKey, 24 * 3600, {
      disposition: 'attachment',
      filename: `user-data-export-${userId.slice(0, 8)}.json`,
    });

    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);

    await privacyRepo.updateDataExportRequest(requestId, {
      status: 'COMPLETED',
      fileKey,
      downloadUrl,
      fileSizeBytes,
      expiresAt,
      completedAt: new Date(),
    });

    logger.info({ requestId, userId, fileSizeBytes }, 'User data export completed successfully');
  } catch (err: any) {
    logger.error({ err, requestId, userId }, 'Failed to process user data export');
    await privacyRepo.updateDataExportRequest(requestId, {
      status: 'FAILED',
      errorMessage: err?.message || 'Data export processing failed',
      completedAt: new Date(),
    });
  }
}

export async function getUserDataExports(userId: string) {
  return privacyRepo.listUserDataExports(userId);
}

// -----------------------------------------------------------------------------
// Tenant Data Export
// -----------------------------------------------------------------------------

export async function requestTenantDataExport(
  tenantId: string,
  actorUserId: string,
  ip?: string,
  userAgent?: string,
) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) {
    throw AppError.notFound('Workspace not found');
  }

  const request = await privacyRepo.createDataExportRequest({
    userId: actorUserId,
    tenantId,
    scope: 'TENANT',
    status: 'PENDING',
  });

  if (!request) {
    throw AppError.internal('Failed to create workspace data export request');
  }

  try {
    await maintenanceQueue.add(
      'export-tenant-data',
      { requestId: request.id, tenantId },
      { removeOnComplete: true },
    );
  } catch (err) {
    logger.warn({ err, requestId: request.id }, 'Could not enqueue export-tenant-data job, running inline fallback');
    processTenantDataExport(request.id, tenantId).catch((processErr) => {
      logger.error({ processErr, requestId: request.id }, 'Inline tenant export fallback failed');
    });
  }

  await logSecurityEvent({
    tenantId,
    actorUserId,
    userId: actorUserId,
    actorType: 'USER',
    action: 'tenant:data_export_requested',
    resourceType: 'DataExportRequest',
    resourceId: request.id,
    ipAddress: ip,
    userAgent,
    metadata: { scope: 'TENANT', tenantSlug: tenant.slug },
  });

  return request;
}

export async function processTenantDataExport(requestId: string, tenantId: string) {
  logger.info({ requestId, tenantId }, 'Processing tenant data export');

  await privacyRepo.updateDataExportRequest(requestId, {
    status: 'PROCESSING',
  });

  try {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

    // 1. Members
    const members = await db
      .select({
        id: schema.tenantMembers.id,
        userId: schema.tenantMembers.userId,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        status: schema.tenantMembers.status,
        joinedAt: schema.tenantMembers.joinedAt,
      })
      .from(schema.tenantMembers)
      .innerJoin(users, eq(schema.tenantMembers.userId, users.id))
      .where(eq(schema.tenantMembers.tenantId, tenantId));

    // 2. Roles & Permissions
    const rolesList = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.tenantId, tenantId));

    // 3. User Groups
    const groups = await db
      .select()
      .from(schema.userGroups)
      .where(eq(schema.userGroups.tenantId, tenantId));

    // 4. File manifest
    const fileManifest = await db
      .select({
        id: files.id,
        filename: files.filename,
        contentType: files.contentType,
        size: files.size,
        status: files.status,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(eq(files.tenantId, tenantId))
      .orderBy(desc(files.createdAt))
      .limit(500);

    // 5. Invoices & Billing
    const invoicesList = await db
      .select({
        id: schema.invoices.id,
        invoiceNumber: schema.invoices.invoiceNumber,
        status: schema.invoices.status,
        currency: schema.invoices.currency,
        totalCents: schema.invoices.totalCents,
        createdAt: schema.invoices.createdAt,
      })
      .from(schema.invoices)
      .where(eq(schema.invoices.tenantId, tenantId))
      .limit(100);

    const payload = {
      exportId: requestId,
      exportedAt: new Date().toISOString(),
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        country: tenant.country,
        region: tenant.region,
        timezone: tenant.timezone,
        currency: tenant.currency,
        createdAt: tenant.createdAt,
      },
      members,
      roles: rolesList,
      groups,
      fileManifest,
      invoices: invoicesList,
    };

    const payloadJson = JSON.stringify(payload, null, 2);
    const fileKey = `data-exports/tenant/${tenantId}/${requestId}.json`;
    const fileSizeBytes = Buffer.byteLength(payloadJson, 'utf-8');

    await putObject(fileKey, payloadJson, 'application/json', {
      tenantId,
      requestId,
      scope: 'TENANT',
    });

    const downloadUrl = await createDownloadUrl(fileKey, 24 * 3600, {
      disposition: 'attachment',
      filename: `workspace-export-${tenant.slug}-${requestId.slice(0, 8)}.json`,
    });

    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);

    await privacyRepo.updateDataExportRequest(requestId, {
      status: 'COMPLETED',
      fileKey,
      downloadUrl,
      fileSizeBytes,
      expiresAt,
      completedAt: new Date(),
    });

    logger.info({ requestId, tenantId, fileSizeBytes }, 'Tenant data export completed successfully');
  } catch (err: any) {
    logger.error({ err, requestId, tenantId }, 'Failed to process tenant data export');
    await privacyRepo.updateDataExportRequest(requestId, {
      status: 'FAILED',
      errorMessage: err?.message || 'Tenant data export failed',
      completedAt: new Date(),
    });
  }
}

export async function getTenantDataExports(tenantId: string) {
  return privacyRepo.listTenantDataExports(tenantId);
}

// -----------------------------------------------------------------------------
// Account Deletion Workflow (14-day cooling period)
// -----------------------------------------------------------------------------

export async function requestAccountDeletion(
  userId: string,
  options: { password?: string; reason?: string },
  ip?: string,
  userAgent?: string,
) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw AppError.notFound('User not found');

  if (user.passwordHash && options.password) {
    const isValid = await bcrypt.compare(options.password, user.passwordHash);
    if (!isValid) {
      throw AppError.badRequest('Incorrect password. Please verify your password to continue.');
    }
  }

  const soleOwnerTenants = await privacyRepo.getUserSoleOwnerTenants(userId);
  if (soleOwnerTenants.length > 0) {
    const tenantNames = soleOwnerTenants.map((t) => `"${t.name}" (${t.slug})`).join(', ');
    throw AppError.badRequest(
      `Cannot delete account: You are the sole Owner of workspace(s): ${tenantNames}. You must transfer ownership to another member or close these workspaces before deleting your account.`,
    );
  }

  const existing = await privacyRepo.getActiveAccountDeletionRequest(userId);
  if (existing) {
    return {
      id: existing.id,
      status: existing.status,
      graceEndsAt: existing.graceEndsAt,
      requestedAt: existing.requestedAt,
      coolingPeriodDays: 14,
      alreadyPending: true,
    };
  }

  const graceEndsAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const secret = crypto.randomBytes(32).toString('hex');
  const cancellationSecretHash = crypto.createHash('sha256').update(secret).digest('hex');

  const request = await privacyRepo.createAccountDeletionRequest({
    userId,
    reason: options.reason,
    cancellationSecretHash,
    graceEndsAt,
  });

  if (!request) {
    throw AppError.internal('Failed to create account deletion request');
  }

  await logSecurityEvent({
    userId,
    actorUserId: userId,
    actorType: 'USER',
    action: 'privacy:account_deletion_requested',
    resourceType: 'AccountDeletionRequest',
    resourceId: request.id,
    ipAddress: ip,
    userAgent,
    metadata: { graceEndsAt: graceEndsAt.toISOString(), coolingPeriodDays: 14 },
  });

  return {
    id: request.id,
    status: request.status,
    graceEndsAt: request.graceEndsAt,
    requestedAt: request.requestedAt,
    coolingPeriodDays: 14,
    cancellationSecret: secret,
  };
}

export async function cancelAccountDeletion(
  userId: string,
  ip?: string,
  userAgent?: string,
) {
  const existing = await privacyRepo.getActiveAccountDeletionRequest(userId);
  if (!existing) {
    throw AppError.notFound('No active account deletion request found in cooling period.');
  }

  await privacyRepo.cancelAccountDeletionRequest(existing.id);

  await logSecurityEvent({
    userId,
    actorUserId: userId,
    actorType: 'USER',
    action: 'privacy:account_deletion_canceled',
    resourceType: 'AccountDeletionRequest',
    resourceId: existing.id,
    ipAddress: ip,
    userAgent,
  });

  return {
    success: true,
    message: 'Account deletion request has been canceled successfully.',
  };
}

export async function getAccountDeletionStatus(userId: string) {
  const request = await privacyRepo.getActiveAccountDeletionRequest(userId);
  if (!request) return null;
  return {
    id: request.id,
    status: request.status,
    requestedAt: request.requestedAt,
    graceEndsAt: request.graceEndsAt,
    reason: request.reason,
  };
}

export async function processAccountDeletions() {
  const expiredRequests = await privacyRepo.getExpiredCoolingPeriodRequests();
  logger.info({ count: expiredRequests.length }, 'Checking expired account deletion requests');

  let anonymizedCount = 0;
  let skippedHoldCount = 0;

  for (const req of expiredRequests) {
    try {
      const underHold = await privacyRepo.doesUserBelongToLegalHoldTenant(req.userId);
      if (underHold) {
        logger.warn(
          { userId: req.userId, requestId: req.id },
          'Skipping account deletion: user belongs to a tenant under active legal hold',
        );
        skippedHoldCount++;
        continue;
      }

      await privacyRepo.anonymizeUser(req.userId);
      await privacyRepo.markAccountDeletionAnonymized(req.id);
      anonymizedCount++;

      await logSecurityEvent({
        userId: req.userId,
        actorType: 'SYSTEM',
        action: 'privacy:account_anonymized',
        resourceType: 'AccountDeletionRequest',
        resourceId: req.id,
      });
    } catch (err) {
      logger.error({ err, userId: req.userId, requestId: req.id }, 'Failed to anonymize user');
    }
  }

  return { anonymized: anonymizedCount, skippedUnderHold: skippedHoldCount };
}

// -----------------------------------------------------------------------------
// Tenant Closure & Purge (30-day grace)
// -----------------------------------------------------------------------------

export async function requestTenantClosure(
  tenantId: string,
  actorUserId: string,
  slugConfirmation: string,
  reason?: string,
  ip?: string,
  userAgent?: string,
) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw AppError.notFound('Workspace not found');

  if (tenant.slug.trim().toLowerCase() !== slugConfirmation.trim().toLowerCase()) {
    throw AppError.badRequest(
      `Slug confirmation does not match. Expected "${tenant.slug}", received "${slugConfirmation}".`,
    );
  }

  const underHold = await privacyRepo.isTenantUnderLegalHold(tenantId);
  if (underHold) {
    throw AppError.forbidden('Tenant workspace is subject to an active legal hold and cannot be closed or purged.');
  }

  const now = new Date();
  const purgeScheduledAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

  const updated = await privacyRepo.setTenantClosed(tenantId, {
    closedAt: now,
    purgeScheduledAt,
    status: 'DEACTIVATED',
  });

  if (!updated) {
    throw AppError.internal('Failed to schedule tenant closure');
  }

  await logSecurityEvent({
    tenantId,
    actorUserId,
    userId: actorUserId,
    actorType: 'USER',
    action: 'tenant:closure_requested',
    resourceType: 'Tenant',
    resourceId: tenantId,
    ipAddress: ip,
    userAgent,
    reason,
    metadata: {
      tenantSlug: tenant.slug,
      purgeScheduledAt: purgeScheduledAt.toISOString(),
      gracePeriodDays: 30,
    },
  });

  return {
    tenantId: updated.id,
    name: updated.name,
    slug: updated.slug,
    closedAt: updated.closedAt,
    purgeScheduledAt: updated.purgeScheduledAt,
    gracePeriodDays: 30,
    status: updated.status,
  };
}

export async function cancelTenantClosure(
  tenantId: string,
  actorUserId: string,
  ip?: string,
  userAgent?: string,
) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw AppError.notFound('Workspace not found');

  if (!tenant.closedAt) {
    throw AppError.badRequest('Workspace is not scheduled for closure.');
  }

  const updated = await privacyRepo.cancelTenantClosed(tenantId);
  if (!updated) {
    throw AppError.internal('Failed to cancel workspace closure');
  }

  await logSecurityEvent({
    tenantId,
    actorUserId,
    userId: actorUserId,
    actorType: 'USER',
    action: 'tenant:closure_canceled',
    resourceType: 'Tenant',
    resourceId: tenantId,
    ipAddress: ip,
    userAgent,
  });

  return {
    tenantId: updated.id,
    name: updated.name,
    slug: updated.slug,
    status: updated.status,
    message: 'Workspace closure canceled and restored to ACTIVE.',
  };
}

export async function getTenantClosureStatus(tenantId: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw AppError.notFound('Workspace not found');

  return {
    isClosed: Boolean(tenant.closedAt),
    closedAt: tenant.closedAt,
    purgeScheduledAt: tenant.purgeScheduledAt,
    status: tenant.status,
  };
}

export async function processTenantPurges() {
  const dueTenants = await privacyRepo.getTenantsDueForPurge();
  logger.info({ count: dueTenants.length }, 'Checking tenants due for permanent purge');

  let purgedCount = 0;
  let skippedHoldCount = 0;

  for (const tenant of dueTenants) {
    try {
      const underHold = await privacyRepo.isTenantUnderLegalHold(tenant.id);
      if (underHold) {
        logger.warn({ tenantId: tenant.id }, 'Skipping purge: tenant is under active legal hold');
        skippedHoldCount++;
        continue;
      }

      await privacyRepo.purgeTenantData(tenant.id);

      await privacyRepo.createTenantTombstone({
        tenantId: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        closedAt: tenant.closedAt ?? new Date(),
        purgedAt: new Date(),
      });

      purgedCount++;

      await logSecurityEvent({
        tenantId: tenant.id,
        actorType: 'SYSTEM',
        action: 'tenant:purged',
        resourceType: 'Tenant',
        resourceId: tenant.id,
        metadata: { slug: tenant.slug },
      });
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, 'Failed to purge tenant');
    }
  }

  return { purged: purgedCount, skippedUnderHold: skippedHoldCount };
}

// -----------------------------------------------------------------------------
// Legal Holds
// -----------------------------------------------------------------------------

export async function placeTenantLegalHold(
  tenantId: string,
  staffId: string,
  reason: string,
  ip?: string,
  userAgent?: string,
) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw AppError.notFound('Workspace not found');

  const existing = await privacyRepo.getActiveLegalHold(tenantId);
  if (existing) {
    throw AppError.conflict('An active legal hold is already placed on this workspace.');
  }

  const hold = await privacyRepo.placeLegalHold({
    tenantId,
    reason,
    placedByStaffId: staffId,
  });

  if (!hold) {
    throw AppError.internal('Failed to place legal hold');
  }

  await logSecurityEvent({
    tenantId,
    actorStaffId: staffId,
    actorType: 'PLATFORM_STAFF',
    action: 'tenant:legal_hold_placed',
    resourceType: 'TenantLegalHold',
    resourceId: hold.id,
    reason,
    ipAddress: ip,
    userAgent,
  });

  return hold;
}

export async function releaseTenantLegalHold(
  tenantId: string,
  staffId: string,
  releaseReason?: string,
  ip?: string,
  userAgent?: string,
) {
  const existing = await privacyRepo.getActiveLegalHold(tenantId);
  if (!existing) {
    throw AppError.notFound('No active legal hold found on this workspace.');
  }

  const updated = await privacyRepo.releaseLegalHold({
    id: existing.id,
    releasedByStaffId: staffId,
    releaseReason,
  });

  if (!updated) {
    throw AppError.internal('Failed to release legal hold');
  }

  await logSecurityEvent({
    tenantId,
    actorStaffId: staffId,
    actorType: 'PLATFORM_STAFF',
    action: 'tenant:legal_hold_released',
    resourceType: 'TenantLegalHold',
    resourceId: updated.id,
    reason: releaseReason,
    ipAddress: ip,
    userAgent,
  });

  return updated;
}

export async function getTenantLegalHold(tenantId: string) {
  return privacyRepo.getActiveLegalHold(tenantId);
}

export async function listAllLegalHolds(tenantId?: string) {
  return privacyRepo.listLegalHolds(tenantId);
}

// -----------------------------------------------------------------------------
// Consent & Legal Documents
// -----------------------------------------------------------------------------

export async function recordUserConsent(
  userId: string,
  data: {
    type: 'TERMS' | 'PRIVACY' | 'MARKETING' | 'COOKIES';
    version: string;
    tenantId?: string | null;
  },
  ip?: string,
  userAgent?: string,
) {
  const record = await privacyRepo.recordConsent({
    userId,
    tenantId: data.tenantId,
    type: data.type,
    version: data.version,
    ip,
    userAgent,
  });

  if (!record) {
    throw AppError.internal('Failed to record consent');
  }

  await logSecurityEvent({
    userId,
    tenantId: data.tenantId,
    actorUserId: userId,
    actorType: 'USER',
    action: 'privacy:consent_recorded',
    resourceType: 'ConsentRecord',
    resourceId: record.id,
    ipAddress: ip,
    userAgent,
    metadata: { type: data.type, version: data.version },
  });

  return record;
}

export async function getUserConsentStatus(userId: string) {
  const activeDocs = await privacyRepo.listActiveLegalDocuments();
  const userConsents = await privacyRepo.getUserConsentRecords(userId);

  const consentMap = new Map<string, string>();
  for (const c of userConsents) {
    if (!consentMap.has(c.type)) {
      consentMap.set(c.type, c.version);
    }
  }

  const documentStatuses = activeDocs.map((doc) => {
    const acceptedVersion = consentMap.get(doc.type);
    const isAccepted = acceptedVersion === doc.version;
    return {
      documentId: doc.id,
      type: doc.type,
      version: doc.version,
      title: doc.title,
      url: doc.url,
      effectiveAt: doc.effectiveAt,
      acceptedVersion: acceptedVersion ?? null,
      isAccepted,
      requiresAcceptance: !isAccepted,
    };
  });

  const requiresAnyAcceptance = documentStatuses.some(
    (d) => d.requiresAcceptance && (d.type === 'TERMS' || d.type === 'PRIVACY'),
  );

  return {
    documents: documentStatuses,
    requiresAnyAcceptance,
  };
}

export async function upsertLegalDoc(
  data: {
    type: 'TERMS' | 'PRIVACY' | 'MARKETING' | 'COOKIES';
    version: string;
    title: string;
    url: string;
    contentSummary?: string;
    effectiveAt?: Date;
  },
  staffId?: string,
) {
  const doc = await privacyRepo.upsertLegalDocument(data);
  if (!doc) {
    throw AppError.internal('Failed to save legal document');
  }

  if (staffId) {
    await logSecurityEvent({
      actorStaffId: staffId,
      actorType: 'PLATFORM_STAFF',
      action: 'privacy:legal_document_upserted',
      resourceType: 'LegalDocument',
      resourceId: doc.id,
      metadata: { type: doc.type, version: doc.version },
    });
  }

  return doc;
}

// -----------------------------------------------------------------------------
// Retention Policies Sweep
// -----------------------------------------------------------------------------

export async function executeRetentionSweep(options?: { dryRun?: boolean }) {
  const now = new Date();
  logger.info({ dryRun: options?.dryRun }, 'Starting privacy retention sweep');

  const activeHolds = await db
    .select({ tenantId: tenantLegalHolds.tenantId })
    .from(tenantLegalHolds)
    .where(isNull(tenantLegalHolds.releasedAt));
  const holdTenantIds = new Set(activeHolds.map((h) => h.tenantId));

  const results = {
    webhookDeliveriesCleaned: 0,
    notificationsCleaned: 0,
    emailMessagesCleaned: 0,
    staleExportsCleaned: 0,
    accountDeletionsProcessed: 0,
    tenantPurgesProcessed: 0,
  };

  // 1. Webhook Deliveries older than 30 days
  const webhookCutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const oldWebhooks = await db
    .select({ id: webhookDeliveries.id, tenantId: webhookDeliveries.tenantId })
    .from(webhookDeliveries)
    .where(lt(webhookDeliveries.createdAt, webhookCutoff))
    .limit(500);

  const webhooksToDelete = oldWebhooks
    .filter((w) => !holdTenantIds.has(w.tenantId))
    .map((w) => w.id);

  if (webhooksToDelete.length > 0 && !options?.dryRun) {
    await db.delete(webhookDeliveries).where(inArray(webhookDeliveries.id, webhooksToDelete));
  }
  results.webhookDeliveriesCleaned = webhooksToDelete.length;

  // 2. Notifications older than 90 days
  const notificationCutoff = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  const oldNotifications = await db
    .select({ id: notifications.id, tenantId: notifications.tenantId })
    .from(notifications)
    .where(lt(notifications.createdAt, notificationCutoff))
    .limit(500);

  const notifsToDelete = oldNotifications
    .filter((n) => !n.tenantId || !holdTenantIds.has(n.tenantId))
    .map((n) => n.id);

  if (notifsToDelete.length > 0 && !options?.dryRun) {
    await db.delete(notifications).where(inArray(notifications.id, notifsToDelete));
  }
  results.notificationsCleaned = notifsToDelete.length;

  // 3. Email messages older than 90 days
  const emailCutoff = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  const oldEmails = await db
    .select({ id: emailMessages.id, tenantId: emailMessages.tenantId })
    .from(emailMessages)
    .where(lt(emailMessages.createdAt, emailCutoff))
    .limit(500);

  const emailsToDelete = oldEmails
    .filter((e) => !holdTenantIds.has(e.tenantId))
    .map((e) => e.id);

  if (emailsToDelete.length > 0 && !options?.dryRun) {
    await db.delete(emailMessages).where(inArray(emailMessages.id, emailsToDelete));
  }
  results.emailMessagesCleaned = emailsToDelete.length;

  // 4. Stale/expired data exports (> 7 days)
  const exportCutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const staleExports = await db
    .select({ id: dataExportRequests.id })
    .from(dataExportRequests)
    .where(
      and(
        lt(dataExportRequests.createdAt, exportCutoff),
        inArray(dataExportRequests.status, ['COMPLETED', 'FAILED']),
      ),
    )
    .limit(100);

  if (staleExports.length > 0 && !options?.dryRun) {
    await db
      .update(dataExportRequests)
      .set({ downloadUrl: null, fileKey: null })
      .where(inArray(dataExportRequests.id, staleExports.map((e) => e.id)));
  }
  results.staleExportsCleaned = staleExports.length;

  // 5. Account deletions
  if (!options?.dryRun) {
    const deletionRes = await processAccountDeletions();
    results.accountDeletionsProcessed = deletionRes.anonymized;

    const purgeRes = await processTenantPurges();
    results.tenantPurgesProcessed = purgeRes.purged;
  }

  logger.info({ results }, 'Privacy retention sweep completed');
  return results;
}
