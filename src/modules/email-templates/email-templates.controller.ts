import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppError } from '@/lib/errors';
import { AppResponse } from '@/lib/responses';

import * as service from './email-templates.service';

export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const result = await service.listTemplates(tenantId, req.valid?.query || {});
  AppResponse.ok(result).send(res);
});

export const getTemplate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const templateId = String(req.valid?.params?.id ?? req.params.id);
  const template = await service.getTemplate(templateId, tenantId);
  AppResponse.ok(template).send(res);
});

export const createTemplate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const template = await service.createTemplate(tenantId, req.user!.id, req.valid?.body);
  AppResponse.created(template, 'Email template created successfully').send(res);
});

export const updateTemplate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const templateId = String(req.valid?.params?.id ?? req.params.id);
  const template = await service.updateTemplate(
    templateId,
    tenantId,
    req.user!.id,
    req.valid?.body,
  );
  AppResponse.ok(template, 'Email template updated successfully').send(res);
});

export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const templateId = String(req.valid?.params?.id ?? req.params.id);
  await service.deleteTemplate(templateId, tenantId);
  AppResponse.ok({ message: 'Email template deleted successfully' }).send(res);
});

export const listVersions = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const templateId = String(req.valid?.params?.id ?? req.params.id);
  const versions = await service.listTemplateVersions(templateId, tenantId);
  AppResponse.ok(versions).send(res);
});

export const rollbackVersion = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const templateId = String(req.valid?.params?.id ?? req.params.id);
  const version = Number(req.valid?.params?.version ?? req.params.version);
  const template = await service.rollbackVersion(templateId, version, tenantId, req.user!.id);
  AppResponse.ok(template, `Template restored to version ${version}`).send(res);
});

export const testSend = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const templateId = String(req.valid?.params?.id ?? req.params.id);
  const result = await service.testSendTemplate(
    templateId,
    tenantId,
    { id: req.user!.id },
    req.valid?.body,
  );
  AppResponse.ok(result, result.message).send(res);
});

// Delivery Logs
export const listDeliveryLogs = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const result = await service.listDeliveryLogs(tenantId, req.valid?.query || {});
  AppResponse.ok(result).send(res);
});

export const getDeliveryLog = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const logId = String(req.valid?.params?.id ?? req.params.id);
  const message = await service.getDeliveryLogById(logId, tenantId);
  AppResponse.ok(message).send(res);
});

// Suppressions
export const listSuppressions = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const result = await service.listSuppressions(tenantId, req.valid?.query || {});
  AppResponse.ok(result).send(res);
});

export const createSuppression = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const suppression = await service.createSuppression(tenantId, req.valid?.body);
  AppResponse.created(suppression, 'Email address added to suppression list').send(res);
});

export const deleteSuppression = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const suppressionId = String(req.valid?.params?.id ?? req.params.id);
  await service.deleteSuppression(suppressionId, tenantId);
  AppResponse.ok({ message: 'Suppression entry removed' }).send(res);
});

// Bounce webhook
export const bounceWebhook = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.handleBounceWebhook(req.body);
  AppResponse.ok(result, `Processed ${result.processed} bounce/complaint events`).send(res);
});
