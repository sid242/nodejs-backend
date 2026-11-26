import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as messageRepo from '../repositories/whatsapp-message.repository';
import * as messageService from '../services/whatsapp-message.service';

export const sendTemplateMessage = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const message = await messageService.sendTemplateMessage(tenantId, userId, req.body);
  AppResponse.ok(message, 'WhatsApp template message sent successfully').send(res);
});

export const sendTextMessage = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const message = await messageService.sendTextMessage(tenantId, userId, req.body);
  AppResponse.ok(message, 'WhatsApp text message sent successfully').send(res);
});

export const sendMediaMessage = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const message = await messageService.sendMediaMessage(tenantId, userId, req.body);
  AppResponse.ok(message, 'WhatsApp media message sent successfully').send(res);
});

export const listMessages = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { contactId, conversationId, phoneNumberId, limit, offset } = req.query as Record<
    string,
    string | undefined
  >;

  const messages = await messageRepo.listMessages({
    tenantId,
    contactId,
    conversationId,
    phoneNumberId,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  });

  AppResponse.ok(messages, 'Messages fetched successfully').send(res);
});

export const getMessage = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const id = req.params.id as string;
  const message = await messageRepo.findMessageById(tenantId, id);
  AppResponse.ok(message, 'Message fetched successfully').send(res);
});
