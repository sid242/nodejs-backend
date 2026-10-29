import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '@/lib/errors';

export function requirePermission(permission: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.permissions) {
      return next(AppError.forbidden('Tenant context and permissions not established'));
    }

    const hasWildcard = req.permissions.includes('*');
    const hasExplicitPerm = req.permissions.includes(permission);

    if (!hasWildcard && !hasExplicitPerm) {
      return next(AppError.forbidden(`Missing required permission: ${permission}`));
    }

    next();
  };
}

export function requirePermissions(permissionsList: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.permissions) {
      return next(AppError.forbidden('Tenant context and permissions not established'));
    }

    const hasWildcard = req.permissions.includes('*');
    if (hasWildcard) return next();

    const missing = permissionsList.filter((p) => !req.permissions!.includes(p));
    if (missing.length > 0) {
      return next(AppError.forbidden(`Missing required permissions: ${missing.join(', ')}`));
    }

    next();
  };
}

export function requireAnyPermission(permissionsList: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.permissions) {
      return next(AppError.forbidden('Tenant context and permissions not established'));
    }

    const hasWildcard = req.permissions.includes('*');
    if (hasWildcard) return next();

    const hasAny = permissionsList.some((p) => req.permissions!.includes(p));
    if (!hasAny) {
      return next(AppError.forbidden(`Requires at least one of: ${permissionsList.join(', ')}`));
    }

    next();
  };
}

export function requireTenantRole(roleName: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.membership?.roles) {
      return next(AppError.forbidden('Tenant membership roles not established'));
    }

    const hasRole = req.membership.roles.some((r) => r.toLowerCase() === roleName.toLowerCase());
    const isOwner = req.membership.roles.some((r) => r.toLowerCase() === 'owner');
    if (!hasRole && !isOwner) {
      return next(AppError.forbidden(`Requires tenant role: ${roleName}`));
    }

    next();
  };
}
