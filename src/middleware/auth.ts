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
    if (payload?.typ !== 'USER') {
      return next(AppError.unauthorized('Invalid access token type'));
    }
    req.user = { id: payload.sub as string, role: payload?.role ?? 'USER' };

    if (payload?.impersonator) {
      const imp = payload.impersonator;
      const isActive = await isImpersonationSessionActive(imp.sessionId);
      if (!isActive) {
        return next(AppError.unauthorized(AUTH_MESSAGES.IMPERSONATION_REVOKED));
      }
      req.impersonator = imp;
      req.isImpersonated = true;
    }

    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    next(AppError.unauthorized('Invalid or expired access token'));
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
      if (payload?.typ === 'USER') {
        req.user = { id: payload.sub as string, role: payload?.role ?? 'USER' };

        if (payload?.impersonator) {
          const imp = payload.impersonator;
          const isActive = await isImpersonationSessionActive(imp.sessionId);
          if (isActive) {
            req.impersonator = imp;
            req.isImpersonated = true;
          }
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
