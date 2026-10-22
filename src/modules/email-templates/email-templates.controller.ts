import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler.js';
import { AppError } from '@/lib/errors.js';
import { AppResponse } from '@/lib/responses.js';

import * as service from './email-templates.service.js';

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
  const template = await service.getTemplate(String(req.params.id), tenantId);
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
  const template = await service.updateTemplate(String(req.params.id), tenantId, req.valid?.body);
  AppResponse.ok(template, 'Email template updated successfully').send(res);
});

export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  await service.deleteTemplate(String(req.params.id), tenantId);
  AppResponse.ok({ message: 'Email template deleted successfully' }).send(res);
});

export const testSend = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required');
  }
  const result = await service.testSendTemplate(String(req.params.id), tenantId, req.valid?.body);
  AppResponse.ok(result, result.message).send(res);
});
