/** A consistent success envelope for public API endpoints. */
export class AppResponse {
  constructor(status, data, message = 'OK', meta) {
    this.status = status;
    this.data = data;
    this.message = message;
    this.meta = meta;
  }

  static ok(data, message = 'OK', meta) {
    return new AppResponse(200, data, message, meta);
  }

  static created(data, message = 'Created', meta) {
    return new AppResponse(201, data, message, meta);
  }

  toJSON(requestId) {
    const body = { success: true, message: this.message, data: this.data };
    if (this.meta !== undefined) body.meta = this.meta;
    if (requestId) body.requestId = requestId;
    return body;
  }

  send(res) {
    return res.status(this.status).json(this.toJSON(res.req?.id));
  }
}
