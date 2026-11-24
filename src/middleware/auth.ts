import type { NextFunction, Request, Response } from 'express';

import { ACCESS_TOKEN_COOKIE, AUTH_HEADERS } from '@/constants/index';
import { AppError } from '@/lib/errors';
import { requireSupportOrUser } from '@/middleware/support';
import { verifyAccessToken, verifySupportToken } from '@/modules/auth/tokens';

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
    try {
      const payload = verifyAccessToken(token);
      if (payload?.typ !== 'USER') {
        return next(AppError.unauthorized('Invalid access token type'));
      }
      req.user = { id: payload.sub as string, authMethod: payload.authMethod ?? 'PASSWORD' };
      req.authMethod = payload.authMethod ?? 'PASSWORD';
      req.tokenIat = payload.iat;

      if (payload.impersonated) {
        req.isImpersonated = true;
        req.impersonator = {
          userId: String(payload.impersonatorId ?? ''),
          role: String(payload.impersonatorType ?? 'USER'),
          reason: 'Active impersonation session',
          sessionId: String(payload.sessionId ?? ''),
        };
      }

      return next();
    } catch (primaryErr) {
      // Fallback: Check if the token is a valid active support token
      try {
        verifySupportToken(token);
        return requireSupportOrUser(req, _res, next);
      } catch {
        throw primaryErr;
      }
    }
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
        req.user = { id: payload.sub as string };
      }
    }
  } catch {
    // Soft failure for optional auth: proceed unauthenticated
  }
  next();
}
