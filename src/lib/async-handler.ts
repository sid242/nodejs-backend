import type { Request, Response, NextFunction, RequestHandler } from 'express';

export type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<any> | any;

export const asyncHandler =
  (fn: AsyncRouteHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
