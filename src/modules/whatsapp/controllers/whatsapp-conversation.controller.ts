import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as convService from '../services/whatsapp-conversation.service';

export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { status, limit, offset } = req.query as Record<string, string | undefined>;
  const conversations = await convService.listConversations(
    tenantId,
    status,
    limit ? Number(limit) : undefined,
    offset ? Number(offset) : undefined,
  );
  AppResponse.ok(conversations, 'Conversations fetched successfully').send(res);
});

export const getConversationMessages = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const id = req.params.id as string;
  const { limit, offset } = req.query as Record<string, string | undefined>;
  const messages = await convService.getConversationMessages(
    tenantId,
    id,
    limit ? Number(limit) : undefined,
    offset ? Number(offset) : undefined,
  );
  AppResponse.ok(messages, 'Conversation messages fetched successfully').send(res);
});

export const replyToConversation = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const id = req.params.id as string;
  const result = await convService.replyToConversation(tenantId, userId, id, req.body.text);
  AppResponse.ok(result, 'Reply sent successfully').send(res);
});

export const assignConversation = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const id = req.params.id as string;
  const result = await convService.assignConversation(tenantId, userId, id, req.body.staffId);
  AppResponse.ok(result, 'Conversation assignment updated').send(res);
});
