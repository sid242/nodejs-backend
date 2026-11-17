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

export const getSpMetadata = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId as string;
  const xml = await ssoService.getSpMetadata(tenantId, req.headers.host);
  res.setHeader('Content-Type', 'application/xml');
  res.send(xml);
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

export const rotateScimToken = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId as string;
  const tokenId = req.params.tokenId as string;
  const result = await ssoService.rotateScimToken(tenantId, tokenId, req.body);
  AppResponse.ok(result, 'SCIM token rotated successfully').send(res);
});

export const lookupSso = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;
  const result = await ssoService.lookupSso(email);
  AppResponse.ok(result, 'SSO lookup completed').send(res);
});

export const initiateSso = asyncHandler(async (req: Request, res: Response) => {
  const result = await ssoService.initiateSso(req.query as any, req.headers.host);
  AppResponse.ok(result, 'SSO initiated').send(res);
});

export const handleSamlAcs = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId as string | undefined;
  const result = await ssoService.handleSamlAcs(req.body, tenantId);

  // ACS standard flow: redirect browser to tenant canonical handoff URL
  // Never returns raw tokens in HTTP body
  res.redirect(302, result.redirectUrl);
});

export const handleOidcCallback = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId as string | undefined;
  const result = await ssoService.handleOidcCallback(req.query as any, tenantId);

  // OIDC standard flow: redirect browser to tenant canonical handoff URL
  res.redirect(302, result.redirectUrl);
});

/**
 * Universal fallback handler for ACS / callbacks.
 * Routes SAML POST or OIDC code to appropriate handler.
 */
export const handleAcs = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId as string | undefined;

  if (req.body?.SAMLResponse) {
    const result = await ssoService.handleSamlAcs(req.body, tenantId);
    return res.redirect(302, result.redirectUrl);
  }

  if (req.query?.code || req.body?.code) {
    const code = (req.query?.code || req.body?.code) as string;
    const state = (req.query?.state || req.body?.state || req.body?.RelayState) as string;
    const result = await ssoService.handleOidcCallback({ code, state }, tenantId);
    return res.redirect(302, result.redirectUrl);
  }

  // If neither SAML nor OIDC payload was recognized, redirect to login with error
  return res.redirect(302, '/login?error=invalid_sso_response');
});
