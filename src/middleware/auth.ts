import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from '@/lib/errors.js';
import { verifyAccessToken } from '@/modules/auth/tokens.js';
import { ACCESS_TOKEN_COOKIE, AUTH_HEADERS } from '@/constants/index.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  let token: string | undefined;

  const header = req.headers.authorization;
  if (header?.startsWith(AUTH_HEADERS.PREFIX)) {
    token = header.slice(AUTH_HEADERS.PREFIX.length).trim();
  } else if (req.cookies?.[ACCESS_TOKEN_COOKIE]) {
    token = req.cookies[ACCESS_TOKEN_COOKIE];
  }

  if (!token) throw AppError.unauthorized();

  const payload = verifyAccessToken(token); // throws -> 401 via error handler
  req.user = { id: payload.sub as string, role: (payload as any).role };
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    let token: string | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith(AUTH_HEADERS.PREFIX)) {
      token = header.slice(AUTH_HEADERS.PREFIX.length).trim();
    } else if (req.cookies?.[ACCESS_TOKEN_COOKIE]) {
      token = req.cookies[ACCESS_TOKEN_COOKIE];
    }
    if (token) {
      const payload = verifyAccessToken(token);
      req.user = { id: payload.sub as string, role: (payload as any).role };
    }
  } catch {
    // Soft failure for optional auth: proceed unauthenticated
  }
  next();
}

export const requireRole =
  (...roles: string[]): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) throw AppError.forbidden();
    next();
  };
