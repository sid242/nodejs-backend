import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as service from './analytics.service';

// -----------------------------------------------------------------------------
// Analytics Overview & KPIs
// -----------------------------------------------------------------------------

export const getAnalyticsOverview = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const range = (req.query.range as '7d' | '30d' | '90d') || '30d';

  const overview = await service.getAnalyticsOverview(tenantId, range);
  res.json(AppResponse.ok(overview, 'Analytics overview retrieved'));
});

// -----------------------------------------------------------------------------
// Usage Metering
// -----------------------------------------------------------------------------

export const recordUsageEvent = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const memberId = req.membership?.id ?? null;

  const event = await service.recordUsage(tenantId, req.body, memberId);
  res.status(201).json(AppResponse.created(event, 'Usage event recorded'));
});

export const getUsageRollup = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const meter = req.query.meter as string | undefined;

  const rollups = await service.getTenantUsageRollup(tenantId, from, to, meter);
  res.json(AppResponse.ok(rollups, 'Usage rollups retrieved'));
});

// -----------------------------------------------------------------------------
// Activity Feed
// -----------------------------------------------------------------------------

export const getActivityFeed = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const cursor = req.query.cursor as string | undefined;
  const entityType = req.query.entityType as string | undefined;

  const feed = await service.getActivityFeed(tenantId, { limit, cursor, entityType });
  res.json(AppResponse.ok(feed, 'Activity feed retrieved'));
});

// -----------------------------------------------------------------------------
// Reports & Exports
// -----------------------------------------------------------------------------

export const createReportDefinition = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const userId = req.user!.id;

  const definition = await service.createReportDefinition(tenantId, req.body, userId);
  res.status(201).json(AppResponse.created(definition, 'Report definition created'));
});

export const listReportDefinitions = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const definitions = await service.listReportDefinitions(tenantId);
  res.json(AppResponse.ok(definitions, 'Report definitions retrieved'));
});

export const triggerReportRun = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const definitionId = String(req.params.id);
  const userId = req.user!.id;

  const run = await service.triggerReportRun(tenantId, definitionId, userId);
  res.status(202).json(AppResponse.created(run, 'Report generation initiated'));
});

export const listReportRuns = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const definitionId = req.query.definitionId as string | undefined;

  const runs = await service.listReportRuns(tenantId, definitionId);
  res.json(AppResponse.ok(runs, 'Report runs retrieved'));
});

// -----------------------------------------------------------------------------
// Platform Executive Metrics
// -----------------------------------------------------------------------------

export const getPlatformMetricsOverview = asyncHandler(async (req: Request, res: Response) => {
  const metrics = await service.getPlatformMetricsOverview();
  res.json(AppResponse.ok(metrics, 'Platform executive metrics retrieved'));
});
