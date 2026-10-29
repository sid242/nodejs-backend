import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';

import { AppError } from '@/lib/errors';
import { captureException } from '@/observability/sentry';

export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` },
    requestId: req.id,
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown = undefined;

  const errObj = (typeof err === 'object' && err !== null ? err : {}) as Record<string, unknown>;

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
  } else if (errObj?.code === '23505') {
    // PostgreSQL unique_violation
    status = 409;
    code = 'CONFLICT';
    message = 'Resource already exists';
  } else if (errObj?.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_JSON';
    message = 'Malformed JSON body';
  } else if (errObj?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Payload too large';
  }

  const log = req?.log;
  if (log) {
    if (status >= 500) log.error({ err }, 'unhandled error');
    else log.warn({ code, message }, 'request failed');
  }

  // Report 5xx unexpected server errors to Sentry
  if (status >= 500) {
    captureException(err, { req });
  }

  res.status(status).json({ error: { code, message, details }, requestId: req?.id });
}
