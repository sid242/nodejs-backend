import { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { scimService } from './scim.service';

export const getServiceProviderConfig = asyncHandler(async (_req: Request, res: Response) => {
  const result = scimService.getServiceProviderConfig();
  res.status(200).json(result);
});

export const getSchemas = asyncHandler(async (_req: Request, res: Response) => {
  const result = scimService.getSchemas();
  res.status(200).json(result);
});

export const getSchemaById = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = scimService.getSchemaById(id);
  res.status(200).json(result);
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const result = await scimService.listUsers(req.tenantId!, req.query as any);
  res.status(200).json(result);
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await scimService.getUser(req.tenantId!, id);
  res.status(200).json(result);
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const result = await scimService.createUser(req.tenantId!, req.body);
  res.status(201).json(result);
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await scimService.updateUser(req.tenantId!, id, req.body);
  res.status(200).json(result);
});

export const patchUser = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await scimService.patchUser(req.tenantId!, id, req.body);
  res.status(200).json(result);
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  await scimService.deleteUser(req.tenantId!, id);
  res.status(204).send();
});

export const listGroups = asyncHandler(async (req: Request, res: Response) => {
  const result = await scimService.listGroups(req.tenantId!, req.query as any);
  res.status(200).json(result);
});

export const getGroup = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await scimService.getGroup(req.tenantId!, id);
  res.status(200).json(result);
});
