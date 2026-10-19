import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '@/lib/errors.js';

/**
 * Middleware that blocks access if the current request is running under an impersonation session.
 * Used on security-critical routes such as password changes, 2FA modifications, or account deletion.
 */
export function blockIfImpersonating(actionName = 'This action'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.isImpersonated) {
      return next(
        AppError.forbidden(
          `${actionName} cannot be performed while impersonating another user. Please exit impersonation first.`,
        ),
      );
    }
    next();
  };
}
