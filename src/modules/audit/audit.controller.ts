import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppError } from '@/lib/errors';
import { AppResponse } from '@/lib/responses';

import * as accessService from './access.service';
import type * as dto from './audit.dto';
import * as auditService from './audit.service';

export const getTenantAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const query = (req.valid?.query ?? {}) as dto.SearchAuditLogsQueryDto;

  const result = await auditService.getAuditTrail({
    ...query,
    tenantId,
  });

  AppResponse.ok(result).send(res);
});

export const exportTenantAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const query = (req.valid?.query ?? {}) as dto.ExportAuditLogsQueryDto;
  const format = query.format ?? 'csv';

  const exportResult = await auditService.exportAuditLogs(tenantId, userId, query, format);

  res.setHeader('Content-Type', exportResult.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
  res.status(200).send(exportResult.content);
});

export const getTenantAuditPolicy = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const policy = await auditService.getTenantAuditPolicy(tenantId);
  AppResponse.ok(policy).send(res);
});

export const updateTenantAuditPolicy = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const body = req.valid!.body as dto.UpdateTenantAuditPolicyDto;

  const updated = await auditService.updateTenantAuditPolicy(tenantId, userId, body);
  AppResponse.ok(updated, 'Audit log retention policy updated successfully').send(res);
});

export const getEffectiveAccess = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const rawTargetId = req.params?.userId ?? req.query?.userId;
  const targetUserId =
    typeof rawTargetId === 'string'
      ? rawTargetId
      : Array.isArray(rawTargetId) && typeof rawTargetId[0] === 'string'
        ? rawTargetId[0]
        : '';

  if (!targetUserId) {
    throw AppError.badRequest('Target user ID is required');
  }

  const access = await accessService.getEffectiveAccess(tenantId, targetUserId);
  AppResponse.ok(access).send(res);
});

export const simulateAccess = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const body = req.valid!.body as dto.SimulateAccessDto;

  const simulation = await accessService.simulateAccess(tenantId, body);
  AppResponse.ok(simulation).send(res);
});
