import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ACCESS_TOKEN_COOKIE, AUTH_HEADERS, AUTH_MESSAGES } from '@/constants/index.js';
import { AppError } from '@/lib/errors.js';
import { isImpersonationSessionActive, verifyAccessToken } from '@/modules/auth/tokens.js';

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  let token: string | undefined;

  const header = req.headers.authorization;
  if (header?.startsWith(AUTH_HEADERS.PREFIX)) {
    token = header.slice(AUTH_HEADERS.PREFIX.length).trim();
  } else if (req.cookies?.[ACCESS_TOKEN_COOKIE]) {
    token = req.cookies[ACCESS_TOKEN_COOKIE];
  }

  if (!token) return next(AppError.unauthorized());

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub as string, role: (payload as any).role };

    if ((payload as any).impersonator) {
      const imp = (payload as any).impersonator;
      const isActive = await isImpersonationSessionActive(imp.sessionId);
      if (!isActive) {
        return next(AppError.unauthorized(AUTH_MESSAGES.IMPERSONATION_REVOKED));
      }
      req.impersonator = imp;
      req.isImpersonated = true;
    }

    next();
  } catch (error) {
    next(error);
  }
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
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

      if ((payload as any).impersonator) {
        const imp = (payload as any).impersonator;
        const isActive = await isImpersonationSessionActive(imp.sessionId);
        if (isActive) {
          req.impersonator = imp;
          req.isImpersonated = true;
        }
      }
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
