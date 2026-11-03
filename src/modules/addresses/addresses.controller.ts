import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppError } from '@/lib/errors';
import { AppResponse } from '@/lib/responses';
import * as tenantRepo from '@/modules/tenants/tenants.repository';
import type { AddressBody, AddressPatch } from './addresses.dto';
import type { OwnerScope } from './addresses.repository';
import * as addressService from './addresses.service';

// --- USER SCOPED (/addresses/me) ---

export const listMyAddresses = asyncHandler(async (req: Request, res: Response) => {
  const scope: OwnerScope = {
    ownerType: 'USER',
    ownerId: req.user!.id,
    tenantId: null,
  };
  const list = await addressService.listAddresses(scope);
  return AppResponse.ok(list).send(res);
});

export const getMyAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope: OwnerScope = {
    ownerType: 'USER',
    ownerId: req.user!.id,
    tenantId: null,
  };
  const address = await addressService.getAddressById(req.params.id as string, scope);
  return AppResponse.ok(address).send(res);
});

export const createMyAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope: OwnerScope = {
    ownerType: 'USER',
    ownerId: req.user!.id,
    tenantId: null,
  };
  const body = req.body as AddressBody;
  const created = await addressService.createAddress(scope, body, req.user!.id);
  return AppResponse.created(created, 'Address created successfully').send(res);
});

export const updateMyAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope: OwnerScope = {
    ownerType: 'USER',
    ownerId: req.user!.id,
    tenantId: null,
  };
  const patch = req.body as AddressPatch;
  const updated = await addressService.updateAddress(
    req.params.id as string,
    scope,
    patch,
    req.user!.id,
  );
  return AppResponse.ok(updated, 'Address updated successfully').send(res);
});

export const deleteMyAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope: OwnerScope = {
    ownerType: 'USER',
    ownerId: req.user!.id,
    tenantId: null,
  };
  await addressService.deleteAddress(req.params.id as string, scope, req.user!.id);
  return AppResponse.ok({ deleted: true }, 'Address deleted successfully').send(res);
});

export const setDefaultMyAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope: OwnerScope = {
    ownerType: 'USER',
    ownerId: req.user!.id,
    tenantId: null,
  };
  const updated = await addressService.setDefaultAddress(
    req.params.id as string,
    scope,
    req.user!.id,
  );
  return AppResponse.ok(updated, 'Default address set successfully').send(res);
});

// --- WORKSPACE TENANT SCOPED (/addresses/workspace) ---

export const listWorkspaceAddresses = asyncHandler(async (req: Request, res: Response) => {
  const scope: OwnerScope = {
    ownerType: 'TENANT',
    ownerId: req.tenant!.id,
    tenantId: req.tenant!.id,
  };
  const list = await addressService.listAddresses(scope);
  return AppResponse.ok(list).send(res);
});

export const getWorkspaceAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope: OwnerScope = {
    ownerType: 'TENANT',
    ownerId: req.tenant!.id,
    tenantId: req.tenant!.id,
  };
  const address = await addressService.getAddressById(req.params.id as string, scope);
  return AppResponse.ok(address).send(res);
});

export const createWorkspaceAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope: OwnerScope = {
    ownerType: 'TENANT',
    ownerId: req.tenant!.id,
    tenantId: req.tenant!.id,
  };
  const body = req.body as AddressBody;
  const created = await addressService.createAddress(scope, body, req.user!.id);
  return AppResponse.created(created, 'Workspace address created successfully').send(res);
});

export const updateWorkspaceAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope: OwnerScope = {
    ownerType: 'TENANT',
    ownerId: req.tenant!.id,
    tenantId: req.tenant!.id,
  };
  const patch = req.body as AddressPatch;
  const updated = await addressService.updateAddress(
    req.params.id as string,
    scope,
    patch,
    req.user!.id,
  );
  return AppResponse.ok(updated, 'Workspace address updated successfully').send(res);
});

export const deleteWorkspaceAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope: OwnerScope = {
    ownerType: 'TENANT',
    ownerId: req.tenant!.id,
    tenantId: req.tenant!.id,
  };
  await addressService.deleteAddress(req.params.id as string, scope, req.user!.id);
  return AppResponse.ok({ deleted: true }, 'Workspace address deleted successfully').send(res);
});

export const setDefaultWorkspaceAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope: OwnerScope = {
    ownerType: 'TENANT',
    ownerId: req.tenant!.id,
    tenantId: req.tenant!.id,
  };
  const updated = await addressService.setDefaultAddress(
    req.params.id as string,
    scope,
    req.user!.id,
  );
  return AppResponse.ok(updated, 'Default workspace address set successfully').send(res);
});

// --- MEMBER SCOPED (/addresses/members/:memberId) ---

async function resolveMemberScope(req: Request): Promise<OwnerScope> {
  const memberId = req.params.memberId as string;
  const member = await tenantRepo.findTenantMemberById(memberId);
  if (!member || member.tenantId !== req.tenant!.id) {
    throw AppError.notFound('Tenant member not found');
  }
  return {
    ownerType: 'MEMBER',
    ownerId: member.id,
    tenantId: req.tenant!.id,
  };
}

export const listMemberAddresses = asyncHandler(async (req: Request, res: Response) => {
  const scope = await resolveMemberScope(req);
  const list = await addressService.listAddresses(scope);
  return AppResponse.ok(list).send(res);
});

export const getMemberAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope = await resolveMemberScope(req);
  const address = await addressService.getAddressById(req.params.id as string, scope);
  return AppResponse.ok(address).send(res);
});

export const createMemberAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope = await resolveMemberScope(req);
  const body = req.body as AddressBody;
  const created = await addressService.createAddress(scope, body, req.user!.id);
  return AppResponse.created(created, 'Member address created successfully').send(res);
});

export const updateMemberAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope = await resolveMemberScope(req);
  const patch = req.body as AddressPatch;
  const updated = await addressService.updateAddress(
    req.params.id as string,
    scope,
    patch,
    req.user!.id,
  );
  return AppResponse.ok(updated, 'Member address updated successfully').send(res);
});

export const deleteMemberAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope = await resolveMemberScope(req);
  await addressService.deleteAddress(req.params.id as string, scope, req.user!.id);
  return AppResponse.ok({ deleted: true }, 'Member address deleted successfully').send(res);
});

export const setDefaultMemberAddress = asyncHandler(async (req: Request, res: Response) => {
  const scope = await resolveMemberScope(req);
  const updated = await addressService.setDefaultAddress(
    req.params.id as string,
    scope,
    req.user!.id,
  );
  return AppResponse.ok(updated, 'Default member address set successfully').send(res);
});

