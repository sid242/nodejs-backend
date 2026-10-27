import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as billingService from './billing.service';

export const getTenantInvoices = asyncHandler(async (req: Request, res: Response) => {
  const result = await billingService.getTenantInvoices(req.tenant!.id, req.valid?.query ?? {});
  AppResponse.ok(result).send(res);
});

export const getTenantInvoiceById = asyncHandler(async (req: Request, res: Response) => {
  const invoiceId = String(req.params.id);
  const result = await billingService.getTenantInvoiceById(req.tenant!.id, invoiceId);
  AppResponse.ok(result).send(res);
});

export const listPlatformInvoices = asyncHandler(async (req: Request, res: Response) => {
  const result = await billingService.getPlatformInvoices(req.valid?.query ?? {});
  AppResponse.ok(result).send(res);
});

export const getPlatformInvoiceById = asyncHandler(async (req: Request, res: Response) => {
  const invoiceId = String(req.params.id);
  const result = await billingService.getPlatformInvoiceById(invoiceId);
  AppResponse.ok(result).send(res);
});

export const createPlatformInvoice = asyncHandler(async (req: Request, res: Response) => {
  const result = await billingService.createInvoice(req.valid!.body);
  AppResponse.created(result, 'Invoice generated successfully').send(res);
});

export const updateInvoiceStatus = asyncHandler(async (req: Request, res: Response) => {
  const invoiceId = String(req.params.id);
  const result = await billingService.updateInvoiceStatus(invoiceId, req.valid!.body);
  AppResponse.ok(result, 'Invoice status updated successfully').send(res);
});
