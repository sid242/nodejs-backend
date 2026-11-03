import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';
import type { GetChildrenQuery, LookupQuery, PinParam } from './geo.dto';
import * as geoService from './geo.service';

export const getStates = asyncHandler(async (_req: Request, res: Response) => {
  const data = await geoService.getStates();
  return AppResponse.ok(data).send(res);
});

export const getChildren = asyncHandler(async (req: Request, res: Response) => {
  const { parentId, level, q } = req.query as unknown as GetChildrenQuery;
  const data = await geoService.getChildren(parentId, level, q);
  return AppResponse.ok(data).send(res);
});

export const getPin = asyncHandler(async (req: Request, res: Response) => {
  const { pin } = req.params as unknown as PinParam;
  const data = await geoService.getPinDetails(pin);
  return AppResponse.ok(data).send(res);
});

export const lookup = asyncHandler(async (req: Request, res: Response) => {
  const { lat, lng } = req.query as unknown as LookupQuery;
  const data = await geoService.lookupCoordinates(lat, lng);
  return AppResponse.ok(data).send(res);
});

