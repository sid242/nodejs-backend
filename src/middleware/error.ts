import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import jwt from 'jsonwebtoken';
import { AppError } from '@/lib/errors.js';

export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` },
    requestId: req.id,
  });
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: any;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Invalid request';
    details = err.flatten();
  } else if (err instanceof jwt.TokenExpiredError) {
    status = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Token expired';
  } else if (err instanceof jwt.JsonWebTokenError) {
    status = 401;
    code = 'UNAUTHORIZED';
    message = 'Invalid token';
  } else if (err?.code === '23505') {
    // PostgreSQL unique_violation
    status = 409;
    code = 'CONFLICT';
    message = 'Resource already exists';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_JSON';
    message = 'Malformed JSON body';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Payload too large';
  }

  const log = (req as any).log;
  if (log) {
    if (status >= 500) log.error({ err }, 'unhandled error');
    else log.warn({ code, message }, 'request failed');
  }

  res.status(status).json({ error: { code, message, details }, requestId: req.id });
}
