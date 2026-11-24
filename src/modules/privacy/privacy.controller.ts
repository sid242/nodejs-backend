import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as service from './privacy.service';

// -----------------------------------------------------------------------------
// User Privacy Handlers
// -----------------------------------------------------------------------------

export const requestUserDataExport = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const ip = req.ip || (req.headers['x-forwarded-for'] as string);
  const userAgent = req.headers['user-agent'];

  const request = await service.requestUserDataExport(userId, ip, userAgent);
  res
    .status(202)
    .json(
      AppResponse.created(
        request,
        'Data export request submitted. You will be notified once processing completes.',
      ),
    );
});

export const listUserDataExports = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const exportsList = await service.getUserDataExports(userId);
  res.json(AppResponse.ok(exportsList, 'User data export requests retrieved'));
});

export const requestAccountDeletion = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { password, reason } = req.body;
  const ip = req.ip || (req.headers['x-forwarded-for'] as string);
  const userAgent = req.headers['user-agent'];

  const result = await service.requestAccountDeletion(userId, { password, reason }, ip, userAgent);
  res
    .status(202)
    .json(
      AppResponse.ok(
        result,
        'Account deletion request recorded. Your account enters a 14-day cooling period before permanent anonymization.',
      ),
    );
});

export const cancelAccountDeletion = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const ip = req.ip || (req.headers['x-forwarded-for'] as string);
  const userAgent = req.headers['user-agent'];

  const result = await service.cancelAccountDeletion(userId, ip, userAgent);
  res.json(AppResponse.ok(result, result.message));
});

export const getAccountDeletionStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const status = await service.getAccountDeletionStatus(userId);
  res.json(AppResponse.ok(status, 'Account deletion status retrieved'));
});

// -----------------------------------------------------------------------------
// Tenant Privacy & Closure Handlers
// -----------------------------------------------------------------------------

export const requestTenantDataExport = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const actorUserId = req.user!.id;
  const ip = req.ip || (req.headers['x-forwarded-for'] as string);
  const userAgent = req.headers['user-agent'];

  const request = await service.requestTenantDataExport(tenantId, actorUserId, ip, userAgent);
  res
    .status(202)
    .json(
      AppResponse.created(
        request,
        'Workspace data export initiated. Download link will be available upon completion.',
      ),
    );
});

export const listTenantDataExports = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const exportsList = await service.getTenantDataExports(tenantId);
  res.json(AppResponse.ok(exportsList, 'Workspace data exports retrieved'));
});

export const requestTenantClosure = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const actorUserId = req.user!.id;
  const { slugConfirmation, reason } = req.body;
  const ip = req.ip || (req.headers['x-forwarded-for'] as string);
  const userAgent = req.headers['user-agent'];

  const result = await service.requestTenantClosure(
    tenantId,
    actorUserId,
    slugConfirmation,
    reason,
    ip,
    userAgent,
  );
  res
    .status(202)
    .json(
      AppResponse.ok(
        result,
        'Workspace deactivated and scheduled for purge. A 30-day grace period is now active.',
      ),
    );
});

export const cancelTenantClosure = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const actorUserId = req.user!.id;
  const ip = req.ip || (req.headers['x-forwarded-for'] as string);
  const userAgent = req.headers['user-agent'];

  const result = await service.cancelTenantClosure(tenantId, actorUserId, ip, userAgent);
  res.json(AppResponse.ok(result, result.message));
});

export const getTenantClosureStatus = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const status = await service.getTenantClosureStatus(tenantId);
  res.json(AppResponse.ok(status, 'Workspace closure status retrieved'));
});

// -----------------------------------------------------------------------------
// Consent & Legal Documents Handlers
// -----------------------------------------------------------------------------

export const recordConsent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { type, version, tenantId } = req.body;
  const ip = req.ip || (req.headers['x-forwarded-for'] as string);
  const userAgent = req.headers['user-agent'];

  const record = await service.recordUserConsent(
    userId,
    { type, version, tenantId },
    ip,
    userAgent,
  );
  res.json(AppResponse.created(record, 'Consent record registered'));
});

export const getConsentStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const status = await service.getUserConsentStatus(userId);
  res.json(AppResponse.ok(status, 'Consent status retrieved'));
});

// -----------------------------------------------------------------------------
// Platform Staff Legal Hold & Governance Handlers
// -----------------------------------------------------------------------------

export const placeLegalHold = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const staffId = req.staff!.id;
  const { reason } = req.body;
  const ip = req.ip || (req.headers['x-forwarded-for'] as string);
  const userAgent = req.headers['user-agent'];

  const hold = await service.placeTenantLegalHold(tenantId, staffId, reason, ip, userAgent);
  res.status(201).json(AppResponse.created(hold, 'Legal hold placed on workspace'));
});

export const releaseLegalHold = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const staffId = req.staff!.id;
  const { reason } = req.body;
  const ip = req.ip || (req.headers['x-forwarded-for'] as string);
  const userAgent = req.headers['user-agent'];

  const updated = await service.releaseTenantLegalHold(tenantId, staffId, reason, ip, userAgent);
  res.json(AppResponse.ok(updated, 'Legal hold released'));
});

export const getLegalHold = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const hold = await service.getTenantLegalHold(tenantId);
  res.json(AppResponse.ok(hold, 'Legal hold status retrieved'));
});

export const listLegalHolds = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.query.tenantId as string | undefined;
  const holds = await service.listAllLegalHolds(tenantId);
  res.json(AppResponse.ok(holds, 'Legal holds list retrieved'));
});

export const triggerRetentionSweep = asyncHandler(async (req: Request, res: Response) => {
  const dryRun = req.query.dryRun === 'true';
  const results = await service.executeRetentionSweep({ dryRun });
  res.json(AppResponse.ok(results, 'Retention sweep executed successfully'));
});

export const upsertLegalDocument = asyncHandler(async (req: Request, res: Response) => {
  const staffId = req.staff?.id;
  const doc = await service.upsertLegalDoc(
    {
      ...req.body,
      effectiveAt: req.body.effectiveAt ? new Date(req.body.effectiveAt) : undefined,
    },
    staffId,
  );
  res.status(201).json(AppResponse.created(doc, 'Legal document saved'));
});
