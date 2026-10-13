import type { Request, Response } from 'express';
import { asyncHandler } from '@/lib/async-handler.js';
import { AppResponse } from '@/lib/responses.js';
import { AppError } from '@/lib/errors.js';
import * as rbacRepo from './rbac.repository.js';
import * as rbacService from './rbac.service.js';

export const listPermissions = asyncHandler(async (_req: Request, res: Response) => {
  const perms = await rbacRepo.findAllPermissions();
  AppResponse.ok(perms).send(res);
});

export const getPermission = asyncHandler(async (req: Request, res: Response) => {
  const permissionId = String(req.params.permissionId);
  const result = await rbacService.getPermissionById(permissionId);
  AppResponse.ok(result).send(res);
});

export const createPermission = asyncHandler(async (req: Request, res: Response) => {
  const moduleId = req.params.moduleId ? String(req.params.moduleId) : req.valid?.body?.moduleId;
  if (!moduleId) {
    throw AppError.badRequest('Module ID is required');
  }
  const result = await rbacService.createPermission({
    ...req.valid!.body,
    moduleId,
  });
  AppResponse.created(result, 'Permission created successfully').send(res);
});

export const updatePermission = asyncHandler(async (req: Request, res: Response) => {
  const permissionId = String(req.params.permissionId);
  const result = await rbacService.updatePermission(permissionId, req.valid!.body);
  AppResponse.ok(result, 'Permission updated successfully').send(res);
});

export const deletePermission = asyncHandler(async (req: Request, res: Response) => {
  const permissionId = String(req.params.permissionId);
  await rbacService.deletePermission(permissionId);
  AppResponse.ok({ message: 'Permission deleted successfully' }).send(res);
});

export const listModules = asyncHandler(async (_req: Request, res: Response) => {
  const tree = await rbacService.listModulesWithPermissions();
  AppResponse.ok(tree).send(res);
});

export const getModule = asyncHandler(async (req: Request, res: Response) => {
  const moduleId = String(req.params.moduleId);
  const result = await rbacService.getModuleById(moduleId);
  AppResponse.ok(result).send(res);
});

export const createModule = asyncHandler(async (req: Request, res: Response) => {
  const result = await rbacService.createModule(req.valid!.body);
  AppResponse.created(result, 'Module created successfully').send(res);
});

export const updateModule = asyncHandler(async (req: Request, res: Response) => {
  const moduleId = String(req.params.moduleId);
  const result = await rbacService.updateModule(moduleId, req.valid!.body);
  AppResponse.ok(result, 'Module updated successfully').send(res);
});

export const deleteModule = asyncHandler(async (req: Request, res: Response) => {
  const moduleId = String(req.params.moduleId);
  await rbacService.deleteModule(moduleId);
  AppResponse.ok({ message: 'Module deleted successfully' }).send(res);
});

export const listTenantRoles = asyncHandler(async (req: Request, res: Response) => {
  const rolesList = await rbacRepo.findRolesByTenant(req.tenant?.id ?? null);
  const enriched = await Promise.all(
    rolesList.map(async (role) => {
      const perms = await rbacRepo.getRolePermissionKeys(role.id);
      return { ...role, permissions: perms };
    }),
  );
  AppResponse.ok(enriched).send(res);
});

export const createTenantRole = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, permissions } = req.valid!.body;
  const result = await rbacService.createCustomTenantRole(
    req.tenant!.id,
    name,
    description,
    permissions,
  );
  AppResponse.created(result, 'Role created successfully').send(res);
});

export const updateTenantRole = asyncHandler(async (req: Request, res: Response) => {
  const roleId = String(req.params.roleId);
  const result = await rbacService.updateCustomTenantRole(req.tenant!.id, roleId, req.valid!.body);
  AppResponse.ok(result, 'Role updated successfully').send(res);
});

export const deleteTenantRole = asyncHandler(async (req: Request, res: Response) => {
  const roleId = String(req.params.roleId);
  await rbacService.deleteTenantRole(req.tenant!.id, roleId);
  AppResponse.ok({ message: 'Role deleted successfully' }).send(res);
});

export const listTenantModules = asyncHandler(async (req: Request, res: Response) => {
  const modules = await rbacService.listTenantModules(req.tenant!.id);
  AppResponse.ok(modules).send(res);
});

export const toggleTenantModule = asyncHandler(async (req: Request, res: Response) => {
  const moduleId = String(req.params.moduleId);
  const result = await rbacService.setTenantModuleStatus(
    req.tenant!.id,
    moduleId,
    req.valid!.body.isEnabled,
  );
  AppResponse.ok(result).send(res);
});
