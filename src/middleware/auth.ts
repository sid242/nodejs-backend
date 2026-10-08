import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from '@/lib/errors.js';
import { verifyAccessToken } from '@/modules/auth/tokens.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
  const payload = verifyAccessToken(header.slice(7)); // throws -> 401 via error handler
  req.user = { id: payload.sub as string, role: (payload as any).role };
  next();
}

export const requireRole =
  (...roles: string[]): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) throw AppError.forbidden();
    next();
  };
