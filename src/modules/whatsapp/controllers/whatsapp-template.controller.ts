import type { Request, Response } from 'express';

import type { WhatsAppTemplateCategory, WhatsAppTemplateStatus } from '@/db/schema/enums';
import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as templateService from '../services/whatsapp-template.service';

export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { category, status, language, search, limit, offset } = req.query as Record<
    string,
    string | undefined
  >;

  const templates = await templateService.listTemplates({
    tenantId,
    category: category as WhatsAppTemplateCategory | undefined,
    status: status as WhatsAppTemplateStatus | undefined,
    language,
    search,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  });

  AppResponse.ok(templates, 'Templates fetched successfully').send(res);
});

export const getTemplate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const id = req.params.id as string;
  const template = await templateService.getTemplateById(tenantId, id);
  AppResponse.ok(template, 'Template fetched successfully').send(res);
});

export const createTemplate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const created = await templateService.createDraftTemplate(tenantId, userId, req.body);
  AppResponse.created(created, 'Template created as draft').send(res);
});

export const updateTemplate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const id = req.params.id as string;
  const updated = await templateService.updateTemplate(tenantId, userId, id, req.body);
  AppResponse.ok(updated, 'Template updated successfully').send(res);
});

export const submitTemplate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const id = req.params.id as string;
  const result = await templateService.submitTemplateToMeta(tenantId, userId, id);
  AppResponse.ok(result, 'Template submitted to Meta for approval').send(res);
});

export const syncTemplates = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const result = await templateService.syncTemplates(tenantId, userId);
  AppResponse.ok(result, 'Templates synchronized from Meta').send(res);
});

export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const id = req.params.id as string;
  const result = await templateService.deleteTemplate(tenantId, userId, id);
  AppResponse.ok(result, 'Template deleted successfully').send(res);
});
