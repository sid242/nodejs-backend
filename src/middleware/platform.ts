import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';

import { env } from '@/config/env.js';
import { AUTH_HEADERS } from '@/constants/index.js';
import { AppError } from '@/lib/errors.js';
import * as platformRepo from '@/modules/platform/platform.repository.js';

export const PLATFORM_STAFF_TOKEN_COOKIE = 'platform_staff_token';

/**
 * Platform Authentication Guard: Ensures caller is a verified internal SaaS staff member.
 * Platform staff sessions and identities are strictly decoupled from tenant customer users.
 */
export async function requirePlatformAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  let token: string | undefined;

  const header = req.headers.authorization;
  if (header?.startsWith(AUTH_HEADERS.PREFIX)) {
    token = header.slice(AUTH_HEADERS.PREFIX.length).trim();
  } else if (req.cookies?.[PLATFORM_STAFF_TOKEN_COOKIE]) {
    token = req.cookies[PLATFORM_STAFF_TOKEN_COOKIE];
  }

  if (!token) {
    return next(AppError.unauthorized('Platform staff authentication required'));
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

    // Verify token audience / type is explicitly platform staff
    if ((payload as any).type !== 'PLATFORM_STAFF' && !(payload as any).isPlatformStaff) {
      // If legacy token, verify against platformStaff table directly
      const staffMember = await platformRepo.findStaffById(payload.sub as string);
      if (!staffMember || staffMember.status !== 'ACTIVE') {
        return next(AppError.unauthorized('Invalid or deactivated platform staff identity'));
      }

      const permissions = await platformRepo.getRolePermissionKeys(staffMember.roleId);
      req.staff = {
        id: staffMember.id,
        email: staffMember.email,
        displayName: staffMember.displayName,
        roleId: staffMember.roleId,
        roleKey: staffMember.roleKey ?? 'STAFF',
        permissions,
      };
      return next();
    }

    const staffId = payload.sub as string;
    const staffMember = await platformRepo.findStaffById(staffId);
    if (!staffMember || staffMember.status !== 'ACTIVE') {
      return next(AppError.unauthorized('Platform staff account is deactivated or suspended'));
    }

    const permissions = await platformRepo.getRolePermissionKeys(staffMember.roleId);
    req.staff = {
      id: staffMember.id,
      email: staffMember.email,
      displayName: staffMember.displayName,
      roleId: staffMember.roleId,
      roleKey: staffMember.roleKey ?? 'STAFF',
      permissions,
    };

    next();
  } catch (error) {
    next(AppError.unauthorized('Invalid or expired platform staff token'));
  }
}

/**
 * Server-Side Platform Permission Check:
 * Enforces deny-by-default authorization for protected platform operations.
 */
export function requirePlatformPermission(requiredPermission: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.staff) {
      return next(AppError.unauthorized('Platform staff authentication required'));
    }

    const isSuperAdmin = req.staff.roleKey === 'SUPER_ADMIN';
    const hasWildcard = req.staff.permissions?.includes('*') ?? false;
    const hasPermission = req.staff.permissions?.includes(requiredPermission) ?? false;

    if (!isSuperAdmin && !hasWildcard && !hasPermission) {
      return next(
        AppError.forbidden(`Missing required platform permission: ${requiredPermission}`),
      );
    }

    next();
  };
}
