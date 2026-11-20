import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as service from './developers.service';

function getTenantId(req: Request): string {
  const tenantId =
    req.tenant?.id ??
    (Array.isArray(req.params?.tenantId) ? req.params.tenantId[0] : req.params?.tenantId) ??
    (Array.isArray(req.params?.id) ? req.params.id[0] : req.params?.id);
  return String(tenantId ?? '');
}

// ─── API Keys Controller ────────────────────────────────────────────────────

export const createApiKey = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const result = await service.createApiKey(tenantId, req.user?.id, req.valid?.body ?? req.body);
  return AppResponse.created(result, result.message).send(res);
});

export const listApiKeys = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const result = await service.listApiKeys(tenantId, req.valid?.query ?? req.query);
  return AppResponse.ok(result.items, undefined, {
    total: result.total,
    page: result.page,
    limit: result.limit,
  }).send(res);
});

export const getApiKey = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const keyId = String(req.params.keyId);
  const key = await service.getApiKey(tenantId, keyId);
  return AppResponse.ok(key).send(res);
});

export const rotateApiKey = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const keyId = String(req.params.keyId);
  const result = await service.rotateApiKey(tenantId, keyId, req.user?.id);
  return AppResponse.ok(result, result.message).send(res);
});

export const revokeApiKey = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const keyId = String(req.params.keyId);
  const revoked = await service.revokeApiKey(tenantId, keyId, req.user?.id);
  return AppResponse.ok(revoked, 'API key revoked successfully').send(res);
});

// ─── Webhook Endpoints Controller ───────────────────────────────────────────

export const createWebhookEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const result = await service.createWebhookEndpoint(
    tenantId,
    req.user?.id,
    req.valid?.body ?? req.body,
  );
  return AppResponse.created(result, result.message).send(res);
});

export const listWebhookEndpoints = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const endpoints = await service.listWebhookEndpoints(tenantId);
  return AppResponse.ok(endpoints).send(res);
});

export const getWebhookEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const endpointId = String(req.params.endpointId);
  const ep = await service.getWebhookEndpoint(tenantId, endpointId);
  return AppResponse.ok(ep).send(res);
});

export const updateWebhookEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const endpointId = String(req.params.endpointId);
  const updated = await service.updateWebhookEndpoint(
    tenantId,
    endpointId,
    req.valid?.body ?? req.body,
    req.user?.id,
  );
  return AppResponse.ok(updated, 'Webhook endpoint updated successfully').send(res);
});

export const deleteWebhookEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const endpointId = String(req.params.endpointId);
  const result = await service.deleteWebhookEndpoint(tenantId, endpointId, req.user?.id);
  return AppResponse.ok(result, result.message).send(res);
});

export const rotateWebhookSecret = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const endpointId = String(req.params.endpointId);
  const result = await service.rotateWebhookSecret(tenantId, endpointId, req.user?.id);
  return AppResponse.ok(result, result.message).send(res);
});

export const listWebhookDeliveries = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const endpointId = String(req.params.endpointId);
  const result = await service.listWebhookDeliveries(
    tenantId,
    endpointId,
    req.valid?.query ?? req.query,
  );
  return AppResponse.ok(result.items, undefined, {
    total: result.total,
    page: result.page,
    limit: result.limit,
  }).send(res);
});

export const redeliverWebhook = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const endpointId = String(req.params.endpointId);
  const deliveryId = String(req.params.deliveryId);
  const result = await service.redeliverWebhook(tenantId, endpointId, deliveryId);
  return AppResponse.ok(result, result.message).send(res);
});

export const sendTestEvent = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const endpointId = String(req.params.endpointId);
  const result = await service.sendTestEvent(tenantId, endpointId);
  return AppResponse.ok(result, result.message).send(res);
});
