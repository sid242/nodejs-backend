import * as usageRepo from '../repositories/whatsapp-usage.repository';

export async function getUsageSummary(tenantId: string) {
  return usageRepo.getUsageSummary(tenantId);
}

export async function listUsageMessages(tenantId: string, limit = 50, offset = 0) {
  return usageRepo.listUsageRecords(tenantId, limit, offset);
}
