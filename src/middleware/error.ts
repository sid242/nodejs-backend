import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';

import { AppError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { localizeZodError } from '@/lib/i18n/zod-error-map';
import { getLocale } from '@/lib/request-context';
import { captureException } from '@/observability/sentry';

export function notFound(req: Request, res: Response): void {
  const localized = t('errors.NOT_FOUND');
  const base = localized !== 'errors.NOT_FOUND' ? localized : 'Resource not found';
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `${base}: ${req.method} ${req.originalUrl}` },
    requestId: req.id,
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown = undefined;
  let params: Record<string, unknown> | undefined = undefined;

  const errObj = (typeof err === 'object' && err !== null ? err : {}) as Record<string, unknown>;

  if (err instanceof AppError) {
    ({ status, code, message, details, params } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    const locale = getLocale();
    const localizedErr = localizeZodError(err, locale);
    const localizedCodeMsg = t('errors.VALIDATION_ERROR');
    message = localizedCodeMsg !== 'errors.VALIDATION_ERROR' ? localizedCodeMsg : 'Invalid request';
    details = localizedErr.flatten();
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

  // Look up localized error text for the resolved error code.
  // Only override with the generic i18n text when the error carries the
  // default placeholder (e.g. "Bad request"); preserve specific messages like
  // "24-hour customer service window is closed" so the client and logs see
  // the actionable reason.
  if (!(err instanceof ZodError)) {
    const localizedMsg = t(`errors.${code}`, params);
    if (localizedMsg && localizedMsg !== `errors.${code}`) {
      // AppError with a specific message that differs from the generic i18n
      // default should NOT be overwritten.
      const hasSpecificMessage = err instanceof AppError && message !== localizedMsg;
      if (!hasSpecificMessage) {
        message = localizedMsg;
      }
    }
  }

  const log = req?.log;
  if (log) {
    if (status >= 500) log.error({ err }, 'unhandled error');
    else log.warn({ code, message, details }, 'request failed');
  }

  // Report 5xx unexpected server errors to Sentry
  if (status >= 500) {
    captureException(err, { req });
  }

  res.status(status).json({ error: { code, message, details }, requestId: req?.id });
}
