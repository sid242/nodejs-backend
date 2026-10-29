import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';

import { env } from '@/config/env';
import { AUTH_HEADERS } from '@/constants/index';
import { AppError } from '@/lib/errors';
import * as platformRepo from '@/modules/platform/platform.repository';

export const PLATFORM_STAFF_TOKEN_COOKIE = 'platform_staff_token';

export interface PlatformStaffJwtPayload extends JwtPayload {
  sub: string;
  email: string;
  type: 'PLATFORM_STAFF';
  roleKey?: string;
  roleId?: string;
}

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
    const decoded = jwt.verify(token, env.JWT_PLATFORM_SECRET, {
      audience: 'platform-api',
    });
    if (!decoded || typeof decoded !== 'object') {
      return next(AppError.unauthorized('Malformed platform staff token'));
    }

    const payload = decoded as PlatformStaffJwtPayload & { typ?: string };

    // Strict boundary enforcement: require explicit STAFF token typ.
    // Standard customer access tokens cannot authenticate to platform endpoints.
    if (payload.typ !== 'STAFF') {
      return next(AppError.unauthorized('Invalid platform staff token type'));
    }

    const staffId = payload.sub;
    if (!staffId) {
      return next(AppError.unauthorized('Platform staff token missing subject'));
    }

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
  } catch {
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
