import { logger } from '@/config/logger.js';
import type { AuditLog, NewAuditLog } from '@/db/schema/index.js';

import * as auditRepo from './audit.repository.js';

export async function logSecurityEvent(event: NewAuditLog): Promise<void> {
  try {
    await auditRepo.createAuditLog(event);
  } catch (error) {
    // Non-blocking: audit log failure should never crash user transactions
    logger.error({ err: error, action: event.action }, 'Failed to record audit log');
  }
}

export async function getAuditTrail(filters: auditRepo.AuditLogFilters): Promise<{
  items: AuditLog[];
  total: number;
  page: number;
  limit: number;
}> {
  return auditRepo.findAuditLogs(filters);
}

export interface ImpersonatorMeta {
  userId: string;
  role?: string;
  reason?: string;
  sessionId?: string;
}

/**
 * Enriches audit log metadata with dual-actor impersonation context whenever active,
 * guaranteeing audit trail compliance with DPDP Act and HIPAA.
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
