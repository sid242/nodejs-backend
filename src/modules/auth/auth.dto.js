import { z } from 'zod';

const emailSchema = z.string().email().max(254);
const passwordSchema = z.string().min(8).max(128);

export const registerDto = z.object({
  name: z.string().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
});

export const loginDto = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const refreshTokenDto = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordDto = z.object({
  email: emailSchema,
});

export const resetPasswordDto = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const verifyEmailDto = z.object({
  token: z.string().min(1),
});
