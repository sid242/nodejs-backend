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

export const refreshTokenDto = z
  .object({
    refreshToken: z.string().min(1).optional(),
  })
  .default({});

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

export const changePasswordDto = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export type ChangePasswordDto = z.infer<typeof changePasswordDto>;

export const requestEmailVerificationDto = z
  .object({
    email: emailSchema.optional(),
  })
  .default({});

export type RequestEmailVerificationDto = z.infer<typeof requestEmailVerificationDto>;

export const verifyEmailDto = z.object({
  token: z.string().min(1),
});

export type VerifyEmailDto = z.infer<typeof verifyEmailDto>;

export const impersonateUserDto = z.object({
  targetUserId: z.string().uuid(),
  reason: z.string().min(5).max(500),
  durationMinutes: z.number().int().min(5).max(120).default(30),
});

export type ImpersonateUserDto = z.infer<typeof impersonateUserDto>;

export const requestMagicLinkDto = z.object({
  email: emailSchema,
});

export type RequestMagicLinkDto = z.infer<typeof requestMagicLinkDto>;

export const verifyMagicLinkDto = z.object({
  token: z.string().min(1),
});

export type VerifyMagicLinkDto = z.infer<typeof verifyMagicLinkDto>;

// ─── Two-Factor Authentication ──────────────────────────────────────────────────

export const enableTwoFactorDto = z.object({
  code: z
    .string()
    .min(6)
    .max(6)
    .regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
});

export type EnableTwoFactorDto = z.infer<typeof enableTwoFactorDto>;

export const disableTwoFactorDto = z.object({
  password: z.string().min(1),
  code: z
    .string()
    .min(6)
    .max(6)
    .regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
});

export type DisableTwoFactorDto = z.infer<typeof disableTwoFactorDto>;

export const verifyTwoFactorChallengeDto = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(6).max(10), // 6-digit TOTP or 10-char recovery code
});

export type VerifyTwoFactorChallengeDto = z.infer<typeof verifyTwoFactorChallengeDto>;

export const revokeSessionParamsDto = z.object({
  sessionId: z.string().uuid(),
});

export type RevokeSessionParamsDto = z.infer<typeof revokeSessionParamsDto>;
