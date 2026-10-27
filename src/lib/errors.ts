export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(msg = 'Bad request', details?: unknown): AppError {
    return new AppError(400, msg, 'BAD_REQUEST', details);
  }

  static unauthorized(msg = 'Unauthorized', details?: unknown): AppError {
    return new AppError(401, msg, 'UNAUTHORIZED', details);
  }

  static forbidden(msg = 'Forbidden', details?: unknown): AppError {
    return new AppError(403, msg, 'FORBIDDEN', details);
  }

  static notFound(msg = 'Not found', details?: unknown): AppError {
    return new AppError(404, msg, 'NOT_FOUND', details);
  }

  static conflict(msg = 'Conflict', details?: unknown): AppError {
    return new AppError(409, msg, 'CONFLICT', details);
  }

  static internal(msg = 'Internal server error', details?: unknown): AppError {
    return new AppError(500, msg, 'INTERNAL_SERVER_ERROR', details);
  }
}
