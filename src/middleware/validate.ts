import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** validate({ body, query, params }) with zod schemas. Parsed values land in req.valid. */
export const validate =
  (schemas: ValidationSchemas): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    req.valid = {};
    if (schemas.params) req.valid.params = schemas.params.parse(req.params);
    if (schemas.query) req.valid.query = schemas.query.parse(req.query);
    if (schemas.body) req.valid.body = schemas.body.parse(req.body);
    next();
  };
