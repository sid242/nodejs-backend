import { z } from 'zod';

const emailSchema = z.string().email().max(254);
const passwordSchema = z.string().min(8).max(128);

export const registerDto = z.object({
  name: z.string().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
});

export type RegisterDto = z.infer<typeof registerDto>;

export const loginDto = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type LoginDto = z.infer<typeof loginDto>;

export const refreshTokenDto = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshTokenDto = z.infer<typeof refreshTokenDto>;

export const forgotPasswordDto = z.object({
  email: emailSchema,
});

export type ForgotPasswordDto = z.infer<typeof forgotPasswordDto>;

export const resetPasswordDto = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export type ResetPasswordDto = z.infer<typeof resetPasswordDto>;

export const verifyEmailDto = z.object({
  token: z.string().min(1),
});

export type VerifyEmailDto = z.infer<typeof verifyEmailDto>;
