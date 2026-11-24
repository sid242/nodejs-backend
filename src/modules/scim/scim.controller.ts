import { NextFunction, Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppError } from '@/lib/errors';

import { ScimError } from './scim.dto';
import { scimService } from './scim.service';

export const getServiceProviderConfig = asyncHandler(async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const result = scimService.getServiceProviderConfig();
  res.status(200).json(result);
});

export const getSchemas = asyncHandler(async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const result = scimService.getSchemas();
  res.status(200).json(result);
});

export const getSchemaById = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const id = req.params.id as string;
  const result = scimService.getSchemaById(id);
  res.status(200).json(result);
});

export const getResourceTypes = asyncHandler(async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const result = scimService.getResourceTypes();
  res.status(200).json(result);
});

export const getResourceTypeById = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const id = req.params.id as string;
  const result = scimService.getResourceTypeById(id);
  res.status(200).json(result);
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const result = await scimService.listUsers(req.tenantId!, req.query as any);
  res.status(200).json(result);
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const id = req.params.id as string;
  const result = await scimService.getUser(req.tenantId!, id);
  if (result?.meta?.version) {
    res.setHeader('ETag', result.meta.version);
  }
  res.status(200).json(result);
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const result = await scimService.createUser(req.tenantId!, req.body);
  if (result?.meta?.version) {
    res.setHeader('ETag', result.meta.version);
  }
  res.status(201).json(result);
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const id = req.params.id as string;
  const result = await scimService.updateUser(req.tenantId!, id, req.body);
  if (result?.meta?.version) {
    res.setHeader('ETag', result.meta.version);
  }
  res.status(200).json(result);
});

export const patchUser = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const id = req.params.id as string;
  const result = await scimService.patchUser(req.tenantId!, id, req.body);
  if (result?.meta?.version) {
    res.setHeader('ETag', result.meta.version);
  }
  res.status(200).json(result);
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const id = req.params.id as string;
  await scimService.deleteUser(req.tenantId!, id);
  res.status(204).send();
});

export const listGroups = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const result = await scimService.listGroups(req.tenantId!, req.query as any);
  res.status(200).json(result);
});

export const getGroup = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');
  const id = req.params.id as string;
  const result = await scimService.getGroup(req.tenantId!, id);
  res.status(200).json(result);
});

/**
 * Custom Error Handler for SCIM sub-router ensuring RFC 7644 JSON error envelope
 */
export function handleScimErrors(err: any, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    return next(err);
  }

  res.setHeader('Content-Type', 'application/scim+json; charset=utf-8');

  if (err instanceof ScimError) {
    res.status(err.status).json(err.toResponse());
    return;
  }

  if (err instanceof AppError) {
    const scimType =
      err.status === 409 ? 'uniqueness' : err.status === 400 ? 'invalidValue' : undefined;

    res.status(err.status).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: String(err.status),
      ...(scimType ? { scimType } : {}),
      detail: err.message,
    });
    return;
  }

  // Generic unhandled exceptions
  res.status(500).json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: '500',
    detail: err?.message || 'An internal server error occurred',
  });
}
