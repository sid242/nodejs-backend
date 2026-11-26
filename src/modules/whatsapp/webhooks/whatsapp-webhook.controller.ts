import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';

import * as webhookService from '../webhooks/whatsapp-webhook.service';

/**
 * GET /api/v1/webhooks/whatsapp
 * Meta Webhook Verification Handshake
 */
export const verifyWebhook = asyncHandler(async (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;

  const responseChallenge = webhookService.verifySubscription(mode, token, challenge);
  res.status(200).send(responseChallenge);
});

/**
 * POST /api/v1/webhooks/whatsapp
 * Inbound Meta WhatsApp Business Events (Incoming messages, Delivery status updates)
 */
export const handleWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers['x-hub-signature-256'];
  const result = await webhookService.processWebhookPayload(
    req.rawBody,
    signature,
    req.body as Record<string, unknown>,
  );
  res.status(200).json(result);
});
