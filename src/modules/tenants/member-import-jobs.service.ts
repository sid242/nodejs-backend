import { createHash } from 'node:crypto';
import type { Job } from 'bullmq';

import { AppError } from '@/lib/errors';
import { memberImportQueue } from '@/queues/index';

import type { ExecuteMemberImportDto } from './tenants.dto';
import type { executeMemberImport } from './tenants.service';

export interface MemberImportJobData {
  tenantId: string;
  operatorId: string;
  input: ExecuteMemberImportDto;
}

export type ImportOutcome = Awaited<ReturnType<typeof executeMemberImport>>;
type MemberImportJob = Job<MemberImportJobData, ImportOutcome>;

async function snapshot(job: MemberImportJob) {
  const state = await job.getState();
  return {
    id: job.id!,
    state: state === 'completed' || state === 'failed' || state === 'active' ? state : 'waiting',
    progress: typeof job.progress === 'number' ? job.progress : 0,
    result: state === 'completed' ? job.returnvalue : undefined,
  };
}

export async function queueMemberImport(
  tenantId: string,
  operatorId: string,
  input: ExecuteMemberImportDto,
) {
  const jobId = createHash('sha256')
    .update(JSON.stringify([tenantId, operatorId, input]))
    .digest('hex');
  const job = await memberImportQueue.add(
    'members',
    { tenantId, operatorId, input },
    {
      jobId,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 3600, count: 1000 },
    },
  );
  const stored = await memberImportQueue.getJob(jobId);
  return snapshot(stored ?? job);
}

export async function getMemberImportJob(tenantId: string, operatorId: string, jobId: string) {
  const job = await memberImportQueue.getJob(jobId);
  if (!job || job.data.tenantId !== tenantId || job.data.operatorId !== operatorId) {
    throw AppError.notFound('Import job not found');
  }
  return snapshot(job);
}
