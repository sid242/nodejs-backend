import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as platform2FaService from './platform-2fa.service';
import * as service from './platform.service';

// ==========================================
// 1. Staff Authentication & Handlers
// ==========================================

export const login = asyncHandler(async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];
  const result = await service.loginStaff(
    req.valid?.body,
    ip,
    userAgent,
    req.id ? String(req.id) : undefined,
  );

  if ('twoFactorRequired' in result) {
    AppResponse.ok(result, 'Two-factor authentication is required').send(res);
    return;
  }

  res.cookie('platform_staff_token', result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  });
  // Omit raw JWT token from the JSON body to prevent exposure to JavaScript
  AppResponse.ok({ staff: result.staff }, 'Platform staff authenticated successfully').send(res);
});

export const verifyTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];
  const result = await platform2FaService.verifyPlatformTwoFactorChallenge(
    req.valid?.body.challengeToken,
    req.valid?.body.code,
    ip,
    userAgent,
    req.id ? String(req.id) : undefined,
  );

  res.cookie('platform_staff_token', result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  });
  // Omit raw JWT token from the JSON body to prevent exposure to JavaScript
  AppResponse.ok({ staff: result.staff }, 'Platform staff authenticated successfully').send(res);
});

export const setupTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const result = await platform2FaService.setupPlatformTwoFactor(req.staff!.id);
  AppResponse.ok(result, 'TOTP secret generated successfully').send(res);
});

export const enableTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const result = await platform2FaService.enablePlatformTwoFactor(
    req.staff!.id,
    req.valid?.body.code,
  );
  AppResponse.ok(result, result.message).send(res);
});

export const disableTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  const result = await platform2FaService.disablePlatformTwoFactor(
    req.staff!.id,
    req.valid?.body.password,
    req.valid?.body.code,
  );
  AppResponse.ok(result, result.message).send(res);
});

export const getTwoFactorStatus = asyncHandler(async (req: Request, res: Response) => {
  const result = await platform2FaService.getPlatformTwoFactorStatus(req.staff!.id);
  AppResponse.ok(result, 'Platform staff 2FA status retrieved').send(res);
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  AppResponse.ok(req.staff).send(res);
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie('platform_staff_token');
  AppResponse.ok({ success: true }, 'Logged out from platform').send(res);
});

export const listStaff = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.listStaff(req.valid?.query);
  AppResponse.ok(result).send(res);
});

export const getStaff = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getStaffById(req.params.id as string);
  AppResponse.ok(result).send(res);
});

export const createStaff = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.createStaff(
    req.staff!,
    req.valid?.body,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.created(result, 'Platform staff member created successfully').send(res);
});

export const updateStaff = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.updateStaff(
    req.staff!,
    req.params.id as string,
    req.valid?.body,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Platform staff member updated successfully').send(res);
});

export const suspendStaff = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.suspendStaff(
    req.staff!,
    req.params.id as string,
    req.valid?.body?.reason,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Platform staff account suspended successfully').send(res);
});

export const activateStaff = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.activateStaff(
    req.staff!.id,
    req.params.id as string,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Platform staff account activated successfully').send(res);
});

export const resetStaffPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.resetStaffPassword(
    req.staff!.id,
    req.params.id as string,
    req.valid?.body?.newPassword,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, result.message).send(res);
});

// ==========================================
// 2. Roles & Permissions Handlers
// ==========================================

export const listRoles = asyncHandler(async (_req: Request, res: Response) => {
  const result = await service.listRoles();
  AppResponse.ok(result).send(res);
});

export const getRole = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getRoleById(req.params.id as string);
  AppResponse.ok(result).send(res);
});

export const createRole = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.createRole(
    req.staff!.id,
    req.valid?.body,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.created(result, 'Platform role created successfully').send(res);
});

export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.updateRole(
    req.staff!.id,
    req.params.id as string,
    req.valid?.body,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Platform role updated successfully').send(res);
});

export const listPermissions = asyncHandler(async (_req: Request, res: Response) => {
  const result = await service.listPermissions();
  AppResponse.ok(result).send(res);
});

// ==========================================
// 3. Support Sessions Handlers
// ==========================================

export const startSupportSession = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.startSupportSession(
    req.staff!,
    req.params.id as string,
    req.valid?.body,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.created(result, 'Tenant support session initiated and audited').send(res);
});

export const enterSupportSession = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.enterSupportSession(
    req.staff!.id,
    req.params.id as string,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Support session entered successfully').send(res);
});

export const endSupportSession = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.endSupportSession(
    req.staff!,
    req.params.id as string,
    req.valid?.body?.outcome,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Tenant support session terminated').send(res);
});

export const listSupportSessions = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.listSupportSessions(req.valid?.query);
  AppResponse.ok(result).send(res);
});

// ==========================================
// 4. Audit Log Queries
// ==========================================

export const queryAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.queryAuditLogs(req.valid?.query);
  AppResponse.ok(result).send(res);
});

// ==========================================
// 5. Tenant Oversight & Provisioning Handlers
// ==========================================

export const listTenants = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.listTenants(req.valid?.query);
  AppResponse.ok(result).send(res);
});

export const getTenant = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getTenantById(req.params.id as string);
  AppResponse.ok(result).send(res);
});

export const listTenantMembers = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.listTenantMembers(req.params.id as string);
  AppResponse.ok(result).send(res);
});

export const provisionTenant = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.provisionTenant(
    req.staff!.id,
    req.valid?.body,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.created(result, 'Tenant workspace provisioned successfully').send(res);
});

export const updateTenant = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.updateTenant(
    req.staff!.id,
    req.params.id as string,
    req.valid?.body,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Tenant workspace updated successfully').send(res);
});

export const suspendTenant = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.suspendTenant(
    req.staff!.id,
    req.params.id as string,
    req.valid?.body?.reason,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Tenant workspace suspended').send(res);
});

export const activateTenant = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.activateTenant(
    req.staff!.id,
    req.params.id as string,
    req.valid?.body?.reason,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Tenant workspace reactivated').send(res);
});

export const getTenantSubscription = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getTenantSubscription(req.params.id as string);
  AppResponse.ok(result).send(res);
});

export const updateTenantSubscription = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.updateTenantSubscription(
    req.staff!.id,
    req.params.id as string,
    req.valid?.body,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Tenant subscription updated successfully').send(res);
});


// ==========================================
// 6. Tenant Dedicated Database Lifecycle Handlers
// ==========================================

export const migrateTenantDatabase = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.migrateTenantToDedicated(
    req.staff!.id,
    req.params.id as string,
    req.valid?.body,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Tenant successfully migrated to dedicated database cluster').send(res);
});

export const rollbackTenantDatabase = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.rollbackTenantToShared(
    req.staff!.id,
    req.params.id as string,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Tenant successfully rolled back to shared database').send(res);
});

export const getTenantDatabaseHealth = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getTenantDatabaseHealth(req.params.id as string);
  AppResponse.ok(result, 'Tenant database health check completed').send(res);
});

export const getDatabasePoolStats = asyncHandler(async (_req: Request, res: Response) => {
  const result = service.getDatabasePoolStats();
  AppResponse.ok(result, 'Dedicated database connection pools statistics retrieved').send(res);
});
