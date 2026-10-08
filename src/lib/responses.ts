import type { Response } from 'express';

export interface SuccessEnvelope<T = any> {
  success: true;
  message: string;
  data: T;
  meta?: any;
  requestId?: string;
}

/** A consistent success envelope for public API endpoints. */
export class AppResponse<T = any> {
  public readonly status: number;
  public readonly data: T;
  public readonly message: string;
  public readonly meta?: any;

  constructor(status: number, data: T, message = 'OK', meta?: any) {
    this.status = status;
    this.data = data;
    this.message = message;
    this.meta = meta;
  }

  static ok<T>(data: T, message = 'OK', meta?: any): AppResponse<T> {
    return new AppResponse(200, data, message, meta);
  }

  static created<T>(data: T, message = 'Created', meta?: any): AppResponse<T> {
    return new AppResponse(201, data, message, meta);
  }

  toJSON(requestId?: string): SuccessEnvelope<T> {
    const body: SuccessEnvelope<T> = { success: true, message: this.message, data: this.data };
    if (this.meta !== undefined) body.meta = this.meta;
    if (requestId) body.requestId = requestId;
    return body;
  }

  send(res: Response): Response {
    return res.status(this.status).json(this.toJSON((res.req as any)?.id));
  }
}
