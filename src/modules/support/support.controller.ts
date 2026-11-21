import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import type {
  AddTicketMessageDto,
  CreateFeedbackDto,
  CreateTicketDto,
  UpdateTicketDto,
} from './support.dto';
import * as supportService from './support.service';

// ─── Tenant Support Handlers ─────────────────────────────────────────────────

export const listTickets = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;

  const tickets = await supportService.listTenantTickets(tenantId, status);
  res.json(AppResponse.ok(tickets, 'Support tickets retrieved'));
});

export const createTicket = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const userId = req.user?.id!;
  const userName = req.user?.id ? `user-${req.user.id.slice(0, 8)}` : 'User';
  const body = req.body as CreateTicketDto;

  const ticket = await supportService.createTicket(tenantId, userId, userName, body);
  res.status(201).json(AppResponse.created(ticket, 'Support ticket created'));
});

export const getTicket = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const ticketId = String(req.params.ticketId);

  const details = await supportService.getTicketDetails(tenantId, ticketId);
  res.json(AppResponse.ok(details, 'Ticket details retrieved'));
});

export const addMessage = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const ticketId = String(req.params.ticketId);
  const userId = req.user?.id!;
  const userName = req.user?.id ? `user-${req.user.id.slice(0, 8)}` : 'User';
  const body = req.body as AddTicketMessageDto;

  const message = await supportService.addTicketMessage(
    tenantId,
    ticketId,
    { id: userId, name: userName, type: 'USER' },
    body,
  );
  res.status(201).json(AppResponse.created(message, 'Message sent'));
});

export const updateTicket = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const ticketId = String(req.params.ticketId);
  const body = req.body as UpdateTicketDto;

  const updated = await supportService.updateTicket(tenantId, ticketId, body);
  res.json(AppResponse.ok(updated, 'Ticket updated'));
});

// ─── Feedback Handler ────────────────────────────────────────────────────────

export const submitFeedback = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CreateFeedbackDto;
  const tenantId = (req as any).tenantId ?? (req.params.tenantId ? String(req.params.tenantId) : undefined);
  const userId = req.user?.id;

  const feedback = await supportService.submitFeedback(body, { tenantId, userId });
  res.status(201).json(AppResponse.created(feedback, 'Feedback received'));
});

export const listFeedback = asyncHandler(async (req: Request, res: Response) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const items = await supportService.listFeedback(limit);
  res.json(AppResponse.ok(items, 'Feedback items retrieved'));
});

// ─── Platform Staff Queue Handler ────────────────────────────────────────────

export const listPlatformTickets = asyncHandler(async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const tickets = await supportService.listAllPlatformTickets(status);
  res.json(AppResponse.ok(tickets, 'Platform support queue retrieved'));
});
