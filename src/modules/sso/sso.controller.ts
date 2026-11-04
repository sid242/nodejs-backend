import { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';
import { ssoService } from './sso.service';

export const getTenantSsoConfig = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId as string;
  const config = await ssoService.getTenantSsoConfig(tenantId);
  AppResponse.ok(config, 'Tenant SSO configuration retrieved').send(res);
});

export const updateTenantSsoConfig = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId as string;
  const updated = await ssoService.updateTenantSsoConfig(tenantId, req.body);
  AppResponse.ok(updated, 'Tenant SSO configuration updated successfully').send(res);
});

export const testSsoConnection = asyncHandler(async (req: Request, res: Response) => {
  const result = await ssoService.testSsoConnection(req.body);
  AppResponse.ok(result, result.message).send(res);
});

export const createScimToken = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId as string;
  const userId = req.user!.id;
  const result = await ssoService.createScimToken(tenantId, userId, req.body);
  AppResponse.created(result, 'SCIM token generated successfully').send(res);
});

export const listScimTokens = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId as string;
  const tokens = await ssoService.listScimTokens(tenantId);
  AppResponse.ok(tokens, 'SCIM tokens retrieved').send(res);
});

export const revokeScimToken = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId as string;
  const tokenId = req.params.tokenId as string;
  const result = await ssoService.revokeScimToken(tenantId, tokenId);
  AppResponse.ok(result, 'SCIM token revoked').send(res);
});

export const lookupSso = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;
  const result = await ssoService.lookupSso(email);
  AppResponse.ok(result, 'SSO lookup completed').send(res);
});

export const initiateSso = asyncHandler(async (req: Request, res: Response) => {
  const result = await ssoService.initiateSso(req.query as any);
  AppResponse.ok(result, 'SSO initiated').send(res);
});

export const handleAcs = asyncHandler(async (req: Request, res: Response) => {
  const result = await ssoService.handleAcs({ ...req.body, ...req.query });
  AppResponse.ok(result, 'SSO authentication successful').send(res);
});
