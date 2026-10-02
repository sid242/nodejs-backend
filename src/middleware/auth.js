import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
  const payload = verifyAccessToken(header.slice(7)); // throws -> 401 via error handler
  req.user = { id: payload.sub, role: payload.role };
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user?.role)) throw AppError.forbidden();
    next();
  };
