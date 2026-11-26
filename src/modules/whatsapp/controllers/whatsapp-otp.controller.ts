import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as otpService from '../services/whatsapp-otp.service';

export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  const result = await otpService.sendOtp(req.body, req.ip);
  AppResponse.ok(result, 'OTP sent successfully').send(res);
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const result = await otpService.verifyOtp(req.body);
  AppResponse.ok(result, 'OTP verified successfully').send(res);
});
