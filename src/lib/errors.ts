export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly params?: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    code = 'ERROR',
    details?: unknown,
    params?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.params = params;
  }

  static badRequest(
    msg = 'Bad request',
    details?: unknown,
    params?: Record<string, unknown>,
  ): AppError {
    return new AppError(400, msg, 'BAD_REQUEST', details, params);
  }

  static unauthorized(
    msg = 'Unauthorized',
    details?: unknown,
    params?: Record<string, unknown>,
  ): AppError {
    return new AppError(401, msg, 'UNAUTHORIZED', details, params);
  }

  static forbidden(
    msg = 'Forbidden',
    details?: unknown,
    params?: Record<string, unknown>,
  ): AppError {
    return new AppError(403, msg, 'FORBIDDEN', details, params);
  }

  static notFound(
    msg = 'Not found',
    details?: unknown,
    params?: Record<string, unknown>,
  ): AppError {
    return new AppError(404, msg, 'NOT_FOUND', details, params);
  }

  static conflict(msg = 'Conflict', details?: unknown, params?: Record<string, unknown>): AppError {
    return new AppError(409, msg, 'CONFLICT', details, params);
  }

  static tooManyRequests(
    msg = 'Too many requests',
    details?: unknown,
    params?: Record<string, unknown>,
  ): AppError {
    return new AppError(429, msg, 'TOO_MANY_REQUESTS', details, params);
  }

  static internal(
    msg = 'Internal server error',
    details?: unknown,
    params?: Record<string, unknown>,
  ): AppError {
    return new AppError(500, msg, 'INTERNAL_SERVER_ERROR', details, params);
  }

  static serviceUnavailable(
    msg = 'Service unavailable',
    details?: unknown,
    params?: Record<string, unknown>,
  ): AppError {
    return new AppError(503, msg, 'SERVICE_UNAVAILABLE', details, params);
  }
}
