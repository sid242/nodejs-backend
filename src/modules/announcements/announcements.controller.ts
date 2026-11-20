import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as service from './announcements.service';

export const getActiveAnnouncements = asyncHandler(async (req: Request, res: Response) => {
  const context = {
    userId: req.user?.id,
    tenantId: req.tenant?.id ?? (req.query.tenantId as string),
    plan: req.query.plan as string,
    roles: req.query.role ? [String(req.query.role)] : undefined,
  };

  const items = await service.getActiveAnnouncements(context);
  return AppResponse.ok(items).send(res);
});

export const dismissAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const announcementId = String(req.params.id);

  const result = await service.dismissAnnouncement(announcementId, userId);
  return AppResponse.ok(result, 'Announcement dismissed').send(res);
});

export const listChangelog = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10));
  const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit || '20'), 10)));

  const result = await service.listChangelog(page, limit);
  return AppResponse.ok(result.items, undefined, result.pagination).send(res);
});

// ─── Platform Handlers ───────────────────────────────────────────────────────

export const listAllAnnouncements = asyncHandler(async (_req: Request, res: Response) => {
  const items = await service.listAllAnnouncements();
  return AppResponse.ok(items).send(res);
});

export const getAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const item = await service.getAnnouncement(String(req.params.id));
  return AppResponse.ok(item).send(res);
});

export const createAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const item = await service.createAnnouncement(req.valid?.body ?? req.body, req.staff?.id);
  return AppResponse.created(item, 'Announcement created').send(res);
});

export const updateAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const item = await service.updateAnnouncement(String(req.params.id), req.valid?.body ?? req.body);
  return AppResponse.ok(item, 'Announcement updated').send(res);
});

export const deleteAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.deleteAnnouncement(String(req.params.id));
  return AppResponse.ok(result, 'Announcement deleted').send(res);
});

export const createChangelog = asyncHandler(async (req: Request, res: Response) => {
  const item = await service.createChangelog(req.valid?.body ?? req.body);
  return AppResponse.created(item, 'Changelog entry created').send(res);
});

export const updateChangelog = asyncHandler(async (req: Request, res: Response) => {
  const item = await service.updateChangelog(String(req.params.id), req.valid?.body ?? req.body);
  return AppResponse.ok(item, 'Changelog entry updated').send(res);
});

export const deleteChangelog = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.deleteChangelog(String(req.params.id));
  return AppResponse.ok(result, 'Changelog entry deleted').send(res);
});
