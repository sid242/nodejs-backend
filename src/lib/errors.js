export class AppError extends Error {
  constructor(status, message, code = 'ERROR', details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  static badRequest(msg = 'Bad request', details) {
    return new AppError(400, msg, 'BAD_REQUEST', details);
  }
  static unauthorized(msg = 'Unauthorized') {
    return new AppError(401, msg, 'UNAUTHORIZED');
  }
  static forbidden(msg = 'Forbidden') {
    return new AppError(403, msg, 'FORBIDDEN');
  }
  static notFound(msg = 'Not found') {
    return new AppError(404, msg, 'NOT_FOUND');
  }
  static conflict(msg = 'Conflict') {
    return new AppError(409, msg, 'CONFLICT');
  }
}
