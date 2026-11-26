import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as campaignService from '../services/whatsapp-campaign.service';

export const listCampaigns = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const campaigns = await campaignService.listCampaigns(tenantId);
  AppResponse.ok(campaigns, 'Campaigns fetched successfully').send(res);
});

export const getCampaign = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const id = req.params.id as string;
  const campaign = await campaignService.getCampaign(tenantId, id);
  AppResponse.ok(campaign, 'Campaign details fetched successfully').send(res);
});

export const createCampaign = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const campaign = await campaignService.createCampaign(tenantId, userId, req.body);
  AppResponse.created(campaign, 'WhatsApp campaign created').send(res);
});

export const scheduleCampaign = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const id = req.params.id as string;
  const result = await campaignService.scheduleCampaign(tenantId, userId, id, req.body.scheduledAt);
  AppResponse.ok(result, 'Campaign scheduled successfully').send(res);
});

export const cancelCampaign = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const id = req.params.id as string;
  const result = await campaignService.cancelCampaign(tenantId, userId, id);
  AppResponse.ok(result, 'Campaign cancelled').send(res);
});
