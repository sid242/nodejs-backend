import { logger } from '@/config/logger.js';
import * as auditRepo from './audit.repository.js';
import type { NewAuditLog, AuditLog } from '@/db/schema/index.js';

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
