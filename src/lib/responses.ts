import type { Response } from 'express';

export interface SuccessEnvelope<T = unknown> {
  success: true;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
  requestId?: string;
}

/** A consistent success envelope for public API endpoints. */
export class AppResponse<T = unknown> {
  public readonly status: number;
  public readonly data: T;
  public readonly message: string;
  public readonly meta?: Record<string, unknown>;

  constructor(status: number, data: T, message = 'OK', meta?: Record<string, unknown>) {
    this.status = status;
    this.data = data;
    this.message = message;
    this.meta = meta;
  }

  static ok<T>(data: T, message = 'OK', meta?: Record<string, unknown>): AppResponse<T> {
    return new AppResponse(200, data, message, meta);
  }

  static created<T>(data: T, message = 'Created', meta?: Record<string, unknown>): AppResponse<T> {
    return new AppResponse(201, data, message, meta);
  }

  toJSON(requestId?: string): SuccessEnvelope<T> {
    const body: SuccessEnvelope<T> = { success: true, message: this.message, data: this.data };
    if (this.meta !== undefined) body.meta = this.meta;
    if (requestId) body.requestId = requestId;
    return body;
  }

  send(res: Response): Response {
    return res.status(this.status).json(this.toJSON((res?.req as { id?: string } | undefined)?.id));
  }
}
