import { UnrecoverableError, type Job } from 'bullmq';

import { runWithTenantDb } from '@/db/tenancy/context';
import { getTenantDb } from '@/lib/db-manager';
import { resolveUserPermissions } from '@/modules/rbac/rbac.service';
import type {
  ImportOutcome,
  MemberImportJobData,
} from '@/modules/tenants/member-import-jobs.service';
import { findTenantById, findTenantMember } from '@/modules/tenants/tenants.repository';
import { executeMemberImport } from '@/modules/tenants/tenants.service';

export async function processMemberImport(job: Job<MemberImportJobData>): Promise<ImportOutcome> {
  const { tenantId, operatorId, input } = job.data;
  const [tenant, member] = await Promise.all([
    findTenantById(tenantId),
    findTenantMember(tenantId, operatorId),
  ]);
  if (tenant?.status !== 'ACTIVE' || member?.status !== 'ACTIVE') {
    throw new UnrecoverableError('Import unavailable');
  }

  const db = await getTenantDb(tenantId);
  return runWithTenantDb({ tenantId, db }, async () => {
    const granted = await resolveUserPermissions(tenantId, operatorId);
    if (
      !granted.permissions.includes('*') &&
      !granted.permissions.includes('members:invite') &&
      !granted.roles.includes('OWNER')
    ) {
      throw new UnrecoverableError('Import unavailable');
    }
    const result = await executeMemberImport(
      tenantId,
      operatorId,
      input.rows,
      input.sendInviteEmails,
      async (processed, total) => {
        await job.updateProgress(Math.floor((processed / total) * 100));
      },
    );
    await job.updateProgress(100);
    return result;
  });
}
