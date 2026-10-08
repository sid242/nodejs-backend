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

  static unauthorized(msg = 'Unauthorized'): AppError {
    return new AppError(401, msg, 'UNAUTHORIZED');
  }

  static forbidden(msg = 'Forbidden'): AppError {
    return new AppError(403, msg, 'FORBIDDEN');
  }

  static notFound(msg = 'Not found'): AppError {
    return new AppError(404, msg, 'NOT_FOUND');
  }

  static conflict(msg = 'Conflict'): AppError {
    return new AppError(409, msg, 'CONFLICT');
  }
}
