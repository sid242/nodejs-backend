import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler.js';
import { AppResponse } from '@/lib/responses.js';

import * as tenantsService from './tenants.service.js';

export const createTenant = asyncHandler(async (req: Request, res: Response) => {
  const result = await tenantsService.createTenantOrganization(req.user!.id, req.valid!.body);
  AppResponse.created(result, 'Tenant organization created successfully').send(res);
});

export const getMyTenants = asyncHandler(async (req: Request, res: Response) => {
  const list = await tenantsService.getUserTenants(req.user!.id);
  AppResponse.ok(list).send(res);
});

export const getTenantContext = asyncHandler(async (req: Request, res: Response) => {
  AppResponse.ok({
    tenant: req.tenant,
    membership: req.membership,
    permissions: req.permissions,
  }).send(res);
});

export const getTenant = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await tenantsService.getTenantDetails(req.tenant!.id);
  AppResponse.ok(tenant).send(res);
});

export const updateTenant = asyncHandler(async (req: Request, res: Response) => {
  const updated = await tenantsService.updateTenantDetails(req.tenant!.id, req.valid!.body);
  AppResponse.ok(updated, 'Tenant updated successfully').send(res);
});

export const listMembers = asyncHandler(async (req: Request, res: Response) => {
  const members = await tenantsService.listMembers(req.tenant!.id);
  AppResponse.ok(members).send(res);
});

export const addMember = asyncHandler(async (req: Request, res: Response) => {
  const { email, role } = req.valid!.body;
  const result = await tenantsService.addMemberToTenant(req.tenant!.id, req.user!.id, email, role);
  AppResponse.created(result, 'Member added successfully').send(res);
});

export const removeMember = asyncHandler(async (req: Request, res: Response) => {
  const memberId = String(req.params.memberId);
  await tenantsService.removeMemberFromTenant(req.tenant!.id, req.user!.id, memberId);
  AppResponse.ok({ message: 'Member removed successfully' }).send(res);
});

export const acceptInvitation = asyncHandler(async (req: Request, res: Response) => {
  const result = await tenantsService.acceptTenantInvitation(
    req.valid!.body.token,
    req.valid!.body.tenantId,
  );
  AppResponse.ok(result, 'Workspace invitation accepted successfully').send(res);
});

export const updateMemberRole = asyncHandler(async (req: Request, res: Response) => {
  const memberId = String(req.params.memberId);
  const result = await tenantsService.updateMemberRole(
    req.tenant!.id,
    req.user!.id,
    memberId,
    req.valid!.body.role,
  );
  AppResponse.ok(result).send(res);
});

export const transferOwnership = asyncHandler(async (req: Request, res: Response) => {
  const memberId = String(req.params.memberId);
  const result = await tenantsService.transferTenantOwnership(
    req.tenant!.id,
    req.user!.id,
    memberId,
    req.valid?.body?.newRoleForFormerOwner ?? 'ADMIN',
  );
  AppResponse.ok(result).send(res);
});

export const getTenantAuditTrail = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query?.page) || 1;
  const limit = Number(req.query?.limit) || 50;
  const logs = await tenantsService.getTenantAuditTrail(req.tenant!.id, page, limit);
  AppResponse.ok(logs).send(res);
});

export const searchTenantAuditTrail = asyncHandler(async (req: Request, res: Response) => {
  const result = await tenantsService.searchTenantAuditTrail(req.tenant!.id, req.valid!.body);
  AppResponse.ok(result).send(res);
});

export const getTenantEmailConfig = asyncHandler(async (req: Request, res: Response) => {
  const config = await tenantsService.getTenantEmailConfig(req.tenant!.id);
  AppResponse.ok(config).send(res);
});

export const upsertTenantEmailConfig = asyncHandler(async (req: Request, res: Response) => {
  const result = await tenantsService.upsertTenantEmailConfig(
    req.tenant!.id,
    req.user!.id,
    req.valid!.body,
  );
  AppResponse.ok(result, 'Tenant email configuration saved successfully').send(res);
});

export const deleteTenantEmailConfig = asyncHandler(async (req: Request, res: Response) => {
  const result = await tenantsService.deleteTenantEmailConfig(req.tenant!.id, req.user!.id);
  AppResponse.ok(result).send(res);
});

export const testTenantEmailConfig = asyncHandler(async (req: Request, res: Response) => {
  const result = await tenantsService.testTenantEmailConfig(req.tenant!.id, req.valid?.body ?? {});
  AppResponse.ok(result).send(res);
});

export const resolvePublicTenant = asyncHandler(async (req: Request, res: Response) => {
  const slug = (req.query?.slug as string) ?? undefined;
  const domain = (req.query?.domain as string) ?? undefined;
  const host =
    (req.query?.host as string) ??
    (req.query?.domain as string) ??
    req.headers['x-forwarded-host']?.toString() ??
    req.headers.host;

  const resolved = await tenantsService.resolvePublicTenant({ slug, domain, host });
  if (!resolved) {
    AppResponse.ok(null, 'No workspace found for specified domain or slug').send(res);
    return;
  }
  AppResponse.ok(resolved).send(res);
});

export const getTenantBranding = asyncHandler(async (req: Request, res: Response) => {
  const branding = await tenantsService.getTenantBranding(req.tenant!.id);
  AppResponse.ok(branding).send(res);
});

export const updateTenantBranding = asyncHandler(async (req: Request, res: Response) => {
  const branding = await tenantsService.updateTenantBranding(
    req.tenant!.id,
    req.user!.id,
    req.valid!.body,
  );
  AppResponse.ok(branding, 'Workspace branding updated successfully').send(res);
});

export const requestBrandingUploadUrl = asyncHandler(async (req: Request, res: Response) => {
  const post = await tenantsService.generateBrandingUploadUrl(req.tenant!.id, req.valid!.body);
  AppResponse.created(post, 'Presigned branding upload URL generated').send(res);
});

export const verifyCustomDomain = asyncHandler(async (req: Request, res: Response) => {
  const bypass = req.valid?.body?.bypassVerification ?? false;
  const branding = await tenantsService.verifyTenantCustomDomain(
    req.tenant!.id,
    req.user!.id,
    bypass,
  );
  AppResponse.ok(branding, 'Custom domain DNS ownership verified successfully').send(res);
});
