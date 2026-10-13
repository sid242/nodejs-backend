export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: any;

  constructor(status: number, message: string, code = 'ERROR', details?: any) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(msg = 'Bad request', details?: any): AppError {
    return new AppError(400, msg, 'BAD_REQUEST', details);
  }

  static unauthorized(msg = 'Unauthorized', details?: any): AppError {
    return new AppError(401, msg, 'UNAUTHORIZED', details);
  }

  static forbidden(msg = 'Forbidden', details?: any): AppError {
    return new AppError(403, msg, 'FORBIDDEN', details);
  }

  static notFound(msg = 'Not found', details?: any): AppError {
    return new AppError(404, msg, 'NOT_FOUND', details);
  }

  static conflict(msg = 'Conflict', details?: any): AppError {
    return new AppError(409, msg, 'CONFLICT', details);
  }

  static internal(msg = 'Internal server error', details?: any): AppError {
    return new AppError(500, msg, 'INTERNAL_SERVER_ERROR', details);
  }
}
