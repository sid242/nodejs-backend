import { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import { CreateLeadDto, ListLeadsQueryDto, UpdateLeadDto } from './leads.dto';
import { leadsService } from './leads.service';

export const listLeads = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const filters = (req.valid?.query ?? req.query) as ListLeadsQueryDto;
  const isOwnerOrSupport = !!req.membership?.roles?.includes('OWNER') || !!req.isSupportSession;

  const result = await leadsService.listLeads(
    tenantId,
    filters,
    req.actorContext,
    req.membership?.roleIds,
    isOwnerOrSupport,
    req.db,
  );

  res.json(
    AppResponse.ok(result.items, 'OK', {
      total: result.total,
      page: result.page,
      limit: result.limit,
    }),
  );
});

export const getLead = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const leadId = (req.valid?.params?.leadId ?? req.params.leadId) as string;
  const lead = await leadsService.getLeadById(tenantId, leadId, req.db);

  res.json(AppResponse.ok(lead));
});

export const createLead = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const body = (req.valid?.body ?? req.body) as CreateLeadDto;
  const created = await leadsService.createLead(tenantId, body, req.user?.id, req.db);

  res.status(201).json(AppResponse.created(created, 'Lead created successfully'));
});

export const updateLead = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const leadId = (req.valid?.params?.leadId ?? req.params.leadId) as string;
  const body = (req.valid?.body ?? req.body) as UpdateLeadDto;
  const updated = await leadsService.updateLead(tenantId, leadId, body, req.user?.id, req.db);

  res.json(AppResponse.ok(updated, 'Lead updated successfully'));
});

export const deleteLead = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const leadId = (req.valid?.params?.leadId ?? req.params.leadId) as string;
  await leadsService.deleteLead(tenantId, leadId, req.db);

  res.json(AppResponse.ok(null, 'Lead deleted successfully'));
});
