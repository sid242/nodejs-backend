import type { Request, Response } from 'express';
import { asyncHandler } from '@/lib/async-handler.js';
import { AppResponse } from '@/lib/responses.js';
import * as service from '@/modules/files/files.service.js';

export const listFiles = asyncHandler(async (req: Request, res: Response) => {
  const files = await service.listFiles(req.user!.id);
  AppResponse.ok(files).send(res);
});

export const requestUpload = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.requestUpload(req.user!.id, req.valid?.body);
  AppResponse.created(result, 'Upload requested').send(res);
});

export const confirmUpload = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.confirmUpload(req.user!.id, req.valid?.params.id);
  AppResponse.ok(result, 'Upload confirmed').send(res);
});

export const getDownloadUrl = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getDownloadUrl(req.user!.id, req.valid?.params.id);
  AppResponse.ok(result).send(res);
});

export const deleteFile = asyncHandler(async (req: Request, res: Response) => {
  await service.deleteFile(req.user!.id, req.valid?.params.id);
  res.status(204).end();
});
