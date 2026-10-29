import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';
import * as authRepo from '@/modules/auth/auth.repository';

import * as invitationsService from './invitations.service';

function getTenantId(req: Request): string {
  const raw =
    req.tenant?.id ??
    (Array.isArray(req.params?.id) ? req.params.id[0] : req.params?.id) ??
    (Array.isArray(req.params?.tenantId) ? req.params.tenantId[0] : req.params?.tenantId);
  return String(raw ?? '');
}

function getInvitationId(req: Request): string {
  const raw =
    (Array.isArray(req.params?.invId) ? req.params.invId[0] : req.params?.invId) ??
    (Array.isArray(req.params?.invitationId) ? req.params.invitationId[0] : req.params?.invitationId) ??
    (Array.isArray(req.params?.id) ? req.params.id[0] : req.params?.id);
  return String(raw ?? '');
}

export const createInvitation = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const result = await invitationsService.createTenantInvitation(
    tenantId,
    { userId: req.user?.id, staffId: req.staff?.id },
    req.valid?.body ?? req.body,
  );
  return AppResponse.created(result, result.message).send(res);
});

export const listInvitations = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const items = await invitationsService.listTenantInvitations(tenantId);
  return AppResponse.ok(items).send(res);
});

export const revokeInvitation = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const invId = getInvitationId(req);
  const revoked = await invitationsService.revokeTenantInvitation(
    tenantId,
    invId,
    req.user?.id,
  );
  return AppResponse.ok(revoked, 'Invitation revoked successfully').send(res);
});

export const resendInvitation = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const invId = getInvitationId(req);
  const result = await invitationsService.resendTenantInvitation(tenantId, invId);
  return AppResponse.ok(result, result.message).send(res);
});

export const previewInvitation = asyncHandler(async (req: Request, res: Response) => {
  const token = (req.query?.token as string) ?? (req.valid?.query?.token as string) ?? '';
  const preview = await invitationsService.previewInvitation(token);
  return AppResponse.ok(preview).send(res);
});

export const acceptInvitation = asyncHandler(async (req: Request, res: Response) => {
  let clientUser = null;
  if (req.user?.id) {
    const user = await authRepo.findById(req.user.id);
    if (user) {
      clientUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
        phoneNumber: user.phoneNumber,
        phoneVerifiedAt: user.phoneVerifiedAt,
        twoFactorEnabledAt: user.twoFactorEnabledAt,
        createdAt: user.createdAt,
      };
    }
  }

  const result = await invitationsService.acceptTenantInvitation(
    req.valid?.body ?? req.body,
    clientUser,
  );
  return AppResponse.ok(result, result.message).send(res);
});
