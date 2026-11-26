import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as usageService from '../services/whatsapp-usage.service';

export const getUsageSummary = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const summary = await usageService.getUsageSummary(tenantId);
  AppResponse.ok(summary, 'Usage summary fetched successfully').send(res);
});

export const listUsageMessages = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { limit, offset } = req.query as Record<string, string | undefined>;
  const messages = await usageService.listUsageMessages(
    tenantId,
    limit ? Number(limit) : undefined,
    offset ? Number(offset) : undefined,
  );
  AppResponse.ok(messages, 'Usage messages fetched successfully').send(res);
});
