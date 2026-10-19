import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { errorResponse, successResponse } from '@/docs/helpers.js';
import { UserSchema } from '@/docs/routes/users.docs.js';
import {
  forgotPasswordDto,
  impersonateUserDto,
  loginDto,
  refreshTokenDto,
  registerDto,
  requestEmailVerificationDto,
  resetPasswordDto,
  verifyEmailDto,
} from '@/modules/auth/auth.dto.js';

export function registerAuthDocs(registry: OpenAPIRegistry): void {
  const RegisterInput = registry.register('RegisterInput', registerDto);
  const LoginInput = registry.register('LoginInput', loginDto);
  const TokenInput = registry.register('TokenInput', refreshTokenDto);
  const ForgotPasswordInput = registry.register('ForgotPasswordInput', forgotPasswordDto);
  const ResetPasswordInput = registry.register('ResetPasswordInput', resetPasswordDto);
  const RequestEmailVerificationInput = registry.register(
    'RequestEmailVerificationInput',
    requestEmailVerificationDto,
  );
  const VerifyEmailInput = registry.register('VerifyEmailInput', verifyEmailDto);
  const ImpersonateInput = registry.register('ImpersonateInput', impersonateUserDto);

  const AuthResponseData = registry.register(
    'AuthResponseData',
    z.object({
      user: UserSchema,
      accessToken: z.string().openapi({ description: 'Short-lived JWT access token (15m)' }),
      refreshToken: z.string().openapi({ description: 'Long-lived opaque refresh token (7d)' }),
    }),
  );

  // --- Auth Routes ---
  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/register',
    summary: 'Register new user',
    description:
      'Creates a new user account with hashed password and returns access/refresh tokens.',
    tags: ['Auth'],
    request: {
      body: {
        description: 'User registration payload',
        content: { 'application/json': { schema: RegisterInput } },
      },
    },
    responses: {
      201: successResponse(AuthResponseData, 'User registered successfully'),
      400: errorResponse('Invalid input'),
      409: errorResponse('Email already registered'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/login',
    summary: 'User login',
    description: 'Authenticates with email and password, returning JWT access and refresh tokens.',
    tags: ['Auth'],
    request: {
      body: {
        description: 'Login credentials',
        content: { 'application/json': { schema: LoginInput } },
      },
    },
    responses: {
      200: successResponse(AuthResponseData, 'Logged in successfully'),
      400: errorResponse('Invalid credentials format'),
      401: errorResponse('Invalid email or password'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/refresh',
    summary: 'Refresh access token',
    description:
      'Exchanges a valid refresh token for a new access token and rotated refresh token. Accepts token via JSON body (mobile/API) or HttpOnly cookie (web).',
    tags: ['Auth'],
    request: {
      body: {
        description: 'Refresh token payload (optional when using HttpOnly cookie)',
        content: { 'application/json': { schema: TokenInput } },
      },
    },
    responses: {
      200: successResponse(
        z.object({
          accessToken: z.string(),
          refreshToken: z.string(),
        }),
        'Tokens refreshed successfully',
      ),
      401: errorResponse('Invalid or expired refresh token'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/logout',
    summary: 'Logout user',
    description:
      'Revokes the refresh token and clears auth cookies. Accepts token via JSON body (mobile) or HttpOnly cookie (web).',
    tags: ['Auth'],
    request: {
      body: {
        description: 'Refresh token to revoke (optional when using HttpOnly cookie)',
        content: { 'application/json': { schema: TokenInput } },
      },
    },
    responses: {
      204: { description: 'Logged out successfully, no content' },
      400: errorResponse('Bad request'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/forgot-password',
    summary: 'Request password reset',
    description: 'Generates a password reset token and enqueues a reset email via AWS SES.',
    tags: ['Auth'],
    request: {
      body: {
        description: 'User email address',
        content: { 'application/json': { schema: ForgotPasswordInput } },
      },
    },
    responses: {
      200: successResponse(
        z.object({ message: z.string() }),
        'Password reset email enqueued if account exists',
      ),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/reset-password',
    summary: 'Reset password',
    description: 'Resets user password using a verified token received via email.',
    tags: ['Auth'],
    request: {
      body: {
        description: 'Reset token and new password',
        content: { 'application/json': { schema: ResetPasswordInput } },
      },
    },
    responses: {
      200: successResponse(z.object({ message: z.string() }), 'Password reset successfully'),
      400: errorResponse('Invalid or expired token'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/verify-email/request',
    summary: 'Request email verification link',
    description:
      'Sends a verification email. Can be called unauthenticated with an email body, or authenticated with a Bearer token / cookie.',
    tags: ['Auth'],
    request: {
      body: {
        description: 'Optional email payload (if unauthenticated)',
        content: { 'application/json': { schema: RequestEmailVerificationInput } },
      },
    },
    responses: {
      200: successResponse(z.object({ message: z.string() }), 'Verification email enqueued'),
      400: errorResponse('Email already verified'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/verify-email/confirm',
    summary: 'Confirm email verification',
    description: 'Verifies email address using the token provided in the verification email.',
    tags: ['Auth'],
    request: {
      body: {
        description: 'Verification token',
        content: { 'application/json': { schema: VerifyEmailInput } },
      },
    },
    responses: {
      200: successResponse(z.object({ message: z.string() }), 'Email verified successfully'),
      400: errorResponse('Invalid or expired verification token'),
    },
  });

  const ImpersonationResponseData = registry.register(
    'ImpersonationResponseData',
    z.object({
      accessToken: z
        .string()
        .openapi({ description: 'Short-lived JWT impersonation access token' }),
      sessionId: z.string().openapi({ description: 'Active Redis impersonation session ID' }),
      expiresInSeconds: z.number(),
      expiresInMinutes: z.number(),
      targetUser: UserSchema,
    }),
  );

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/impersonate',
    summary: 'Impersonate a user (Admin only)',
    description:
      'Allows a system administrator to assume the identity of a target user for support/investigation with time-boxing and full audit logging.',
    tags: ['Auth'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        description: 'Target user ID, reason, and duration',
        content: { 'application/json': { schema: ImpersonateInput } },
      },
    },
    responses: {
      200: successResponse(ImpersonationResponseData, 'Impersonation session started successfully'),
      400: errorResponse('Cannot impersonate yourself or invalid parameters'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden: cannot impersonate an administrator'),
      404: errorResponse('Target user not found'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/stop-impersonate',
    summary: 'Stop active impersonation session',
    description:
      'Terminates the active impersonation session in Redis and logs an audit exit event.',
    tags: ['Auth'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: successResponse(
        z.object({ message: z.string() }),
        'Impersonation session stopped successfully',
      ),
      400: errorResponse('Not currently in an active impersonation session'),
      401: errorResponse('Unauthorized or expired session'),
    },
  });
}
