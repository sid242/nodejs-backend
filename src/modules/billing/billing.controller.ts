import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as service from './billing.service';

// ==========================================
// 1. Public Plans Catalog
// ==========================================

export const listPublicPlans = asyncHandler(async (_req: Request, res: Response) => {
  const plans = await service.listPublicPlans();
  return AppResponse.ok(plans).send(res);
});

export const getPlanById = asyncHandler(async (req: Request, res: Response) => {
  const plan = await service.getPlanById(req.params.id as string);
  return AppResponse.ok(plan).send(res);
});

// ==========================================
// 2. Tenant Billing Operations
// ==========================================

export const getTenantBillingOverview = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const overview = await service.getTenantBillingOverview(tenantId);
  return AppResponse.ok(overview).send(res);
});

export const requestSubscriptionChange = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const result = await service.requestSubscriptionChange(tenantId, userId, req.body);
  return AppResponse.ok(result, result.message).send(res);
});

export const getTenantInvoices = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const result = await service.getTenantInvoices(tenantId, req.query as any);
  return AppResponse.ok(result.items, undefined, {
    total: result.total,
    page: result.page,
    limit: result.limit,
  }).send(res);
});

export const getTenantInvoiceById = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const invoice = await service.getTenantInvoiceById(tenantId, req.params.invoiceId as string);
  return AppResponse.ok(invoice).send(res);
});

// ==========================================
// 3. Platform Plans & Subscriptions
// ==========================================

export const listPlatformPlans = asyncHandler(async (req: Request, res: Response) => {
  const plans = await service.listAllPlans(req.query as any);
  return AppResponse.ok(plans).send(res);
});

export const createPlan = asyncHandler(async (req: Request, res: Response) => {
  const staffId = req.staff!.id;
  const created = await service.createPlan(staffId, req.body, req.id ? String(req.id) : undefined);
  return AppResponse.created(created, 'Plan created successfully').send(res);
});

export const updatePlan = asyncHandler(async (req: Request, res: Response) => {
  const staffId = req.staff!.id;
  const updated = await service.updatePlan(staffId, req.params.id as string, req.body, req.id ? String(req.id) : undefined);
  return AppResponse.ok(updated, 'Plan updated successfully').send(res);
});

export const getPlatformTenantSubscription = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.params.id as string;
  const data = await service.getPlatformTenantSubscription(tenantId);
  return AppResponse.ok(data).send(res);
});

export const updatePlatformTenantSubscription = asyncHandler(async (req: Request, res: Response) => {
  const staffId = req.staff!.id;
  const tenantId = req.params.id as string;
  const updated = await service.updatePlatformTenantSubscription(
    staffId,
    tenantId,
    req.body,
    req.id ? String(req.id) : undefined,
  );
  return AppResponse.ok(updated, 'Tenant subscription updated successfully').send(res);
});

// ==========================================
// 4. Platform Invoices Operations
// ==========================================

export const listPlatformInvoices = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.listPlatformInvoices(req.query as any);
  return AppResponse.ok(result.items, undefined, {
    total: result.total,
    page: result.page,
    limit: result.limit,
  }).send(res);
});

export const getPlatformInvoiceById = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await service.getPlatformInvoiceById(req.params.id as string);
  return AppResponse.ok(invoice).send(res);
});

export const createPlatformInvoice = asyncHandler(async (req: Request, res: Response) => {
  const staffId = req.staff!.id;
  const created = await service.createPlatformInvoice(staffId, req.body, req.id ? String(req.id) : undefined);
  return AppResponse.created(created, 'Invoice generated successfully').send(res);
});

export const updateInvoiceStatus = asyncHandler(async (req: Request, res: Response) => {
  const staffId = req.staff!.id;
  const updated = await service.updateInvoiceStatus(
    staffId,
    req.params.id as string,
    req.body.status,
    req.body.paidAt,
    req.id ? String(req.id) : undefined,
  );
  return AppResponse.ok(updated, 'Invoice status updated').send(res);
});
