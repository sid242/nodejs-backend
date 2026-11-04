import { logger } from '@/config/logger';
import type { NewAuditLog, TenantAuditPolicy } from '@/db/schema/index';
import { AppError } from '@/lib/errors';
import * as billingService from '@/modules/billing/billing.service';

import { redactSensitiveData } from './audit.redactor';
import * as auditRepo from './audit.repository';

export interface AuditEventPayload {
  tenantId?: string | null;
  userId?: string | null;
  actorUserId?: string | null;
  effectiveUserId?: string | null;
  actorType?: 'USER' | 'PLATFORM_STAFF' | 'SYSTEM';
  actorStaffId?: string | null;
  supportSessionId?: string | null;
  action: string;
  source?: 'DIRECT' | 'GROUP' | 'IMPERSONATION' | 'SYSTEM' | 'JOB' | string;
  result?: 'SUCCESS' | 'FAILURE' | 'DENIED' | string;
  entityType?: string | null;
  entityId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any> | null;
  metadataBefore?: Record<string, any> | null;
  metadataAfter?: Record<string, any> | null;
}

/**
 * Append-only security audit ingestion.
 * Server authoritatively assigns timestamps, redacts sensitive secrets,
 * and captures dual-actor context without ever blocking user workflows.
 */
export async function logSecurityEvent(event: AuditEventPayload): Promise<void> {
  try {
    const actorId = event.actorUserId ?? event.userId ?? null;
    const effectiveId = event.effectiveUserId ?? event.userId ?? actorId;

    const sanitizedData: NewAuditLog = {
      tenantId: event?.tenantId ?? null,
      userId: actorId,
      actorUserId: actorId,
      effectiveUserId: effectiveId,
      actorType: event?.actorType ?? 'USER',
      actorStaffId: event?.actorStaffId ?? null,
      supportSessionId: event?.supportSessionId ?? null,
      action: event.action,
      source: event?.source ?? 'DIRECT',
      result: event?.result ?? 'SUCCESS',
      entityType: event?.entityType ?? event?.resourceType ?? null,
      entityId: event?.entityId ?? event?.resourceId ?? null,
      resourceType: event?.resourceType ?? event?.entityType ?? null,
      resourceId: event?.resourceId ?? event?.entityId ?? null,
      requestId: event?.requestId ?? null,
      correlationId: event?.correlationId ?? null,
      reason: event?.reason ?? null,
      ipAddress: event?.ipAddress ?? null,
      userAgent: event?.userAgent ?? null,
      metadata: event.metadata ? redactSensitiveData(event.metadata) : null,
      metadataBefore: event.metadataBefore ? redactSensitiveData(event.metadataBefore) : null,
      metadataAfter: event.metadataAfter ? redactSensitiveData(event.metadataAfter) : null,
      createdAt: new Date(),
    };

    await auditRepo.createAuditLog(sanitizedData);
  } catch (error) {
    // Non-blocking: audit log failure should never crash user transactions
    logger.error({ err: error, action: event?.action }, 'Failed to record audit log');
  }
}

export async function getAuditTrail(filters: auditRepo.AuditLogFilters): Promise<{
  items: auditRepo.EnrichedAuditLog[];
  total: number;
  page: number;
  limit: number;
}> {
  return auditRepo.findAuditLogs(filters);
}

/**
 * Compliance Export: Stream/string of audit trail filtered by criteria.
 * Gated by workspace plan entitlement 'audit.export'.
 * Logs an append-only audit record of the export action itself.
 */
export async function exportAuditLogs(
  tenantId: string,
  actorUserId: string,
  filters: auditRepo.AuditLogFilters,
  format: 'csv' | 'json' = 'csv',
): Promise<{ content: string; mimeType: string; filename: string; count: number }> {
  // 1. Quota / Entitlement Check
  await billingService.assertQuota(tenantId, 'audit.export');

  // 2. Fetch records
  const items = await auditRepo.findAuditLogsForExport({ ...filters, tenantId });

  // 3. Audit the export event itself (append-only)
  await logSecurityEvent({
    tenantId,
    actorUserId,
    effectiveUserId: actorUserId,
    action: 'audit.logs_exported',
    resourceType: 'AuditLog',
    source: 'DIRECT',
    result: 'SUCCESS',
    metadata: {
      format,
      recordCount: items?.length ?? 0,
      filters: {
        action: filters?.action,
        result: filters?.result,
        source: filters?.source,
        startDate: filters?.startDate,
        endDate: filters?.endDate,
      },
    },
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (format === 'json') {
    return {
      content: JSON.stringify(items, null, 2),
      mimeType: 'application/json',
      filename: `audit-trail-${tenantId}-${timestamp}.json`,
      count: items?.length ?? 0,
    };
  }

  // Format CSV
  const csvHeaders = [
    'timestamp',
    'id',
    'tenantId',
    'action',
    'result',
    'source',
    'actorUserId',
    'actorName',
    'actorEmail',
    'effectiveUserId',
    'effectiveUserName',
    'effectiveUserEmail',
    'resourceType',
    'resourceId',
    'reason',
    'requestId',
    'correlationId',
    'ipAddress',
    'userAgent',
    'metadataBefore',
    'metadataAfter',
    'metadata',
  ];

  const escapeCsv = (val: any): string => {
    if (val === null || val === undefined) return '';
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = items.map((item) =>
    [
      item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
      item.id,
      item.tenantId ?? '',
      item.action,
      item.result,
      item.source,
      item.actorUserId ?? item.userId ?? '',
      item.actorName ?? '',
      item.actorEmail ?? '',
      item.effectiveUserId ?? '',
      item.effectiveUserName ?? '',
      item.effectiveUserEmail ?? '',
      item.resourceType ?? item.entityType ?? '',
      item.resourceId ?? item.entityId ?? '',
      item.reason ?? '',
      item.requestId ?? '',
      item.correlationId ?? '',
      item.ipAddress ?? '',
      item.userAgent ?? '',
      item.metadataBefore ? JSON.stringify(item.metadataBefore) : '',
      item.metadataAfter ? JSON.stringify(item.metadataAfter) : '',
      item.metadata ? JSON.stringify(item.metadata) : '',
    ]
      .map(escapeCsv)
      .join(','),
  );

  const csvContent = [csvHeaders.join(','), ...rows].join('\n');

  return {
    content: csvContent,
    mimeType: 'text/csv; charset=utf-8',
    filename: `audit-trail-${tenantId}-${timestamp}.csv`,
    count: items?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Retention Policies
// ---------------------------------------------------------------------------

export async function getTenantAuditPolicy(tenantId: string): Promise<TenantAuditPolicy> {
  const policy = await auditRepo.findTenantAuditPolicy(tenantId);
  if (policy) return policy;

  // Return default configuration
  return {
    id: 'default',
    tenantId,
    retentionDays: 90,
    exportAllowed: true,
    complianceFramework: 'SOC2',
    lastArchivedAt: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function updateTenantAuditPolicy(
  tenantId: string,
  userId: string,
  data: {
    retentionDays: number;
    exportAllowed?: boolean;
    complianceFramework?: string;
  },
): Promise<TenantAuditPolicy> {
  // Validate against plan max retention limit
  const maxRetention = await getPlanMaxRetentionDays(tenantId);
  if (data.retentionDays > maxRetention) {
    throw AppError.forbidden(
      `Your workspace plan allows a maximum retention window of ${maxRetention} days. Upgrade your subscription for longer compliance retention.`,
    );
  }

  const policy = await auditRepo.upsertTenantAuditPolicy(tenantId, {
    retentionDays: data.retentionDays,
    exportAllowed: data.exportAllowed,
    complianceFramework: data.complianceFramework,
    updatedBy: userId,
  });

  await logSecurityEvent({
    tenantId,
    actorUserId: userId,
    effectiveUserId: userId,
    action: 'audit.policy_updated',
    resourceType: 'TenantAuditPolicy',
    resourceId: policy.id,
    source: 'DIRECT',
    result: 'SUCCESS',
    metadataAfter: {
      retentionDays: data.retentionDays,
      exportAllowed: data.exportAllowed,
      complianceFramework: data.complianceFramework,
    },
  });

  return policy;
}

export async function purgeTenantExpiredLogs(tenantId: string): Promise<{ deletedCount: number }> {
  const policy = await getTenantAuditPolicy(tenantId);
  const result = await auditRepo.purgeLogsOlderThan(tenantId, policy.retentionDays);

  await logSecurityEvent({
    tenantId,
    actorUserId: null,
    effectiveUserId: null,
    actorType: 'SYSTEM',
    action: 'audit.logs_purged',
    resourceType: 'AuditLog',
    source: 'JOB',
    result: 'SUCCESS',
    metadata: {
      retentionDays: policy.retentionDays,
      purgedCount: result.deletedCount,
    },
  });

  return result;
}

async function getPlanMaxRetentionDays(tenantId: string): Promise<number> {
  try {
    const effective = await billingService.getTenantEntitlements(tenantId);
    const entitlement = effective?.entitlements?.['audit.retention_days'];
    if (entitlement && typeof entitlement.value === 'number') {
      return entitlement.value;
    }
    const planKey = effective?.planKey || 'FREE';
    if (planKey === 'ENTERPRISE') return 3650;
    if (planKey === 'PRO') return 90;
    return 30;
  } catch {
    return 90;
  }
}

export interface ImpersonatorMeta {
  userId: string;
  role?: string;
  reason?: string;
  sessionId?: string;
}

/**
 * Enriches audit log metadata with dual-actor impersonation context whenever active,
 * guaranteeing audit trail compliance with DPDP Act, SOC2, and HIPAA.
 */
export function enrichAuditMetadata(
  metadata: Record<string, any> | undefined | null,
  impersonator?: ImpersonatorMeta,
): Record<string, any> | undefined {
  if (!impersonator) return metadata ?? undefined;
  return {
    ...(metadata ?? {}),
    impersonatedBy: impersonator.userId,
    ...(impersonator.role && { impersonatorRole: impersonator.role }),
    ...(impersonator.reason && { impersonationReason: impersonator.reason }),
    ...(impersonator.sessionId && { impersonationSessionId: impersonator.sessionId }),
  };
}
