import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as accountService from '../services/whatsapp-account.service';
import * as onboardingService from '../services/whatsapp-onboarding.service';

export const getAccount = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const account = await accountService.getAccount(tenantId);
  AppResponse.ok(account, 'WhatsApp account fetched successfully').send(res);
});

export const createOnboardingSession = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const session = await onboardingService.createOnboardingSession(tenantId, userId);
  AppResponse.created(session, 'Onboarding session initialized').send(res);
});

export const completeOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const result = await onboardingService.completeOnboarding(tenantId, userId, req.body);
  AppResponse.ok(result, 'WhatsApp account connected successfully').send(res);
});

export const disconnectAccount = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const accountId = req.params.accountId as string;
  const result = await accountService.disconnectAccount(tenantId, userId, accountId);
  AppResponse.ok(result, 'WhatsApp account disconnected').send(res);
});

export const listPhoneNumbers = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const phoneNumbers = await accountService.getPhoneNumbers(tenantId);
  AppResponse.ok(phoneNumbers, 'WhatsApp phone numbers fetched successfully').send(res);
});

export const updatePhoneNumber = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const id = req.params.id as string;
  const { isEnabled, isDefault } = req.body;

  if (isDefault) {
    await accountService.setDefaultPhoneNumber(tenantId, userId, id);
  }
  if (isEnabled !== undefined) {
    await accountService.setPhoneNumberEnabled(tenantId, userId, id, isEnabled);
  }

  const phoneNumbers = await accountService.getPhoneNumbers(tenantId);
  AppResponse.ok(phoneNumbers, 'Phone number updated successfully').send(res);
});

export const refreshAccount = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.id;
  const result = await accountService.refreshAccountStatus(tenantId, userId);
  AppResponse.ok(result, 'WhatsApp account status refreshed').send(res);
});
