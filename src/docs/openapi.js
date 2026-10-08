import { z } from 'zod';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import {
  registerDto,
  loginDto,
  refreshTokenDto,
  forgotPasswordDto,
  resetPasswordDto,
  verifyEmailDto,
} from '../modules/auth/auth.dto.js';
import { updateMeDto, listUsersQueryDto } from '../modules/users/users.dto.js';
import { fileIdParamDto, requestUploadDto } from '../modules/files/files.dto.js';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ---------------------------------------------------------------------------
// Security Schemes
// ---------------------------------------------------------------------------
const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'JWT Access Token in the Authorization header (Bearer <token>)',
});

// ---------------------------------------------------------------------------
// Common Envelope Schemas
// ---------------------------------------------------------------------------
export const SuccessEnvelope = registry.register(
  'SuccessEnvelope',
  z.object({
    success: z.literal(true).openapi({ example: true }),
    message: z.string().optional().openapi({ example: 'Operation successful' }),
    data: z.any().openapi({ description: 'Payload returned by the endpoint' }),
    meta: z.record(z.any()).optional().openapi({ description: 'Pagination or auxiliary metadata' }),
    requestId: z.string().openapi({
      example: 'req_01j7v6m7c6e6r5x0e3q0w1x2y3',
      description: 'Unique request trace ID',
    }),
  }),
);

export const ErrorEnvelope = registry.register(
  'ErrorEnvelope',
  z.object({
    error: z.object({
      code: z.string().openapi({ example: 'BAD_REQUEST', description: 'Application error code' }),
      message: z.string().openapi({ example: 'Validation failed' }),
      details: z
        .any()
        .optional()
        .openapi({ description: 'Field-level validation errors or context' }),
    }),
    requestId: z.string().openapi({
      example: 'req_01j7v6m7c6e6r5x0e3q0w1x2y3',
      description: 'Unique request trace ID',
    }),
  }),
);

function successResponse(schema, description = 'Successful operation') {
  return {
    description,
    content: {
      'application/json': {
        schema: z.object({
          success: z.literal(true),
          message: z.string().optional(),
          data: schema,
          meta: z.record(z.any()).optional(),
          requestId: z.string(),
        }),
      },
    },
  };
}

function errorResponse(description = 'Error response') {
  return {
    description,
    content: {
      'application/json': {
        schema: ErrorEnvelope,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Domain Schemas (Registered from Module DTOs)
// ---------------------------------------------------------------------------

// Auth
const RegisterInput = registry.register('RegisterInput', registerDto);
const LoginInput = registry.register('LoginInput', loginDto);
const TokenInput = registry.register('TokenInput', refreshTokenDto);
const ForgotPasswordInput = registry.register('ForgotPasswordInput', forgotPasswordDto);
const ResetPasswordInput = registry.register('ResetPasswordInput', resetPasswordDto);
const VerifyEmailInput = registry.register('VerifyEmailInput', verifyEmailDto);

const UserSchema = registry.register(
  'User',
  z.object({
    id: z.string().uuid().openapi({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }),
    email: z.string().email().openapi({ example: 'jane.doe@example.com' }),
    name: z.string().openapi({ example: 'Jane Doe' }),
    role: z.enum(['USER', 'ADMIN']).openapi({ example: 'USER' }),
    emailVerified: z.boolean().openapi({ example: true }),
    createdAt: z.string().datetime().openapi({ example: '2026-01-15T08:30:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-01-15T08:30:00.000Z' }),
  }),
);

const AuthResponseData = registry.register(
  'AuthResponseData',
  z.object({
    user: UserSchema,
    accessToken: z.string().openapi({ description: 'Short-lived JWT access token (15m)' }),
    refreshToken: z.string().openapi({ description: 'Long-lived opaque refresh token (7d)' }),
  }),
);

// Users
const UpdateMeInput = registry.register('UpdateMeInput', updateMeDto);

const PaginatedUsersData = registry.register(
  'PaginatedUsersData',
  z.object({
    items: z.array(UserSchema),
    pagination: z.object({
      page: z.number().int().openapi({ example: 1 }),
      limit: z.number().int().openapi({ example: 20 }),
      total: z.number().int().openapi({ example: 100 }),
      totalPages: z.number().int().openapi({ example: 5 }),
    }),
  }),
);

// Files
const FileSchema = registry.register(
  'File',
  z.object({
    id: z.string().uuid().openapi({ example: 'd3b07384-d113-40f4-9ed3-2051d95e6cf1' }),
    filename: z.string().openapi({ example: 'document.pdf' }),
    contentType: z.string().openapi({ example: 'application/pdf' }),
    sizeBytes: z.number().nullable().openapi({ example: 1048576 }),
    status: z.enum(['PENDING', 'READY', 'DELETED']).openapi({ example: 'READY' }),
    createdAt: z.string().datetime().openapi({ example: '2026-01-15T09:00:00.000Z' }),
  }),
);

const FileUploadRequestInput = registry.register('FileUploadRequestInput', requestUploadDto);

const PresignedPostData = registry.register(
  'PresignedPostData',
  z.object({
    fileId: z.string().uuid().openapi({ example: 'd3b07384-d113-40f4-9ed3-2051d95e6cf1' }),
    upload: z.object({
      url: z.string().url().openapi({ example: 'https://my-bucket.s3.amazonaws.com/' }),
      fields: z.record(z.string()).openapi({ description: 'Form fields for S3 direct POST' }),
    }),
  }),
);

const DownloadUrlData = registry.register(
  'DownloadUrlData',
  z.object({
    url: z.string().url().openapi({ description: 'Short-lived presigned S3 download URL' }),
  }),
);

// Health
const HealthLiveResponse = registry.register(
  'HealthLiveResponse',
  z.object({
    status: z.string().openapi({ example: 'ok' }),
  }),
);

const HealthReadyResponse = registry.register(
  'HealthReadyResponse',
  z.object({
    status: z.enum(['ok', 'degraded', 'shutting_down']).openapi({ example: 'ok' }),
    db: z.enum(['fulfilled', 'rejected']).openapi({ example: 'fulfilled' }),
    redis: z.enum(['fulfilled', 'rejected']).openapi({ example: 'fulfilled' }),
    queue: z.enum(['fulfilled', 'rejected']).openapi({ example: 'fulfilled' }),
  }),
);

// ---------------------------------------------------------------------------
// Route Registrations
// ---------------------------------------------------------------------------

// --- Health ---
registry.registerPath({
  method: 'get',
  path: '/health/live',
  summary: 'Liveness probe',
  description: 'Checks if the Node.js API process is up and running. Returns 200 OK.',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Process is alive',
      content: { 'application/json': { schema: HealthLiveResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/health/ready',
  summary: 'Readiness probe',
  description:
    'Validates database, state Redis, and queue connections. Returns 503 during graceful shutdown or when degraded.',
  tags: ['Health'],
  responses: {
    200: {
      description: 'System is healthy and ready to accept traffic',
      content: { 'application/json': { schema: HealthReadyResponse } },
    },
    503: {
      description: 'System is degraded or shutting down',
      content: { 'application/json': { schema: HealthReadyResponse } },
    },
  },
});

// --- Auth ---
registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/register',
  summary: 'Register new user',
  description: 'Creates a new user account with hashed password and returns access/refresh tokens.',
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
  description: 'Exchanges a valid refresh token for a new access token and rotated refresh token.',
  tags: ['Auth'],
  request: {
    body: {
      description: 'Refresh token payload',
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
  description: 'Revokes the given refresh token from Redis.',
  tags: ['Auth'],
  request: {
    body: {
      description: 'Refresh token to revoke',
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
  description: 'Sends a new verification email to the authenticated user.',
  tags: ['Auth'],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: successResponse(z.object({ message: z.string() }), 'Verification email enqueued'),
    401: errorResponse('Unauthorized'),
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

// --- Users ---
registry.registerPath({
  method: 'get',
  path: '/api/v1/users/me',
  summary: 'Get current user profile',
  description: 'Returns the profile of the authenticated user (cached with Redis cache-aside).',
  tags: ['Users'],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: successResponse(UserSchema, 'Current user profile'),
    401: errorResponse('Unauthorized'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/users/me',
  summary: 'Update current user profile',
  description:
    'Updates mutable fields (e.g. name) of the authenticated user and invalidates cache.',
  tags: ['Users'],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      description: 'Profile update fields',
      content: { 'application/json': { schema: UpdateMeInput } },
    },
  },
  responses: {
    200: successResponse(UserSchema, 'Profile updated successfully'),
    400: errorResponse('Validation error'),
    401: errorResponse('Unauthorized'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users',
  summary: 'List users (Admin only)',
  description: 'Returns paginated list of all users. Requires ADMIN role.',
  tags: ['Users'],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: listUsersQueryDto,
  },
  responses: {
    200: successResponse(PaginatedUsersData, 'Paginated list of users'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden - Admin access required'),
  },
});

// --- Files ---
registry.registerPath({
  method: 'get',
  path: '/api/v1/files',
  summary: 'List user files',
  description: 'Returns list of files uploaded by the authenticated user.',
  tags: ['Files'],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: successResponse(z.array(FileSchema), 'List of user files'),
    401: errorResponse('Unauthorized'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/files/upload-url',
  summary: 'Request direct S3 upload URL',
  description:
    'Creates a pending file record and returns short-lived AWS S3 presigned POST credentials for direct client-to-S3 upload.',
  tags: ['Files'],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      description: 'Upload request details',
      content: { 'application/json': { schema: FileUploadRequestInput } },
    },
  },
  responses: {
    201: successResponse(PresignedPostData, 'Presigned upload URL created'),
    400: errorResponse('Invalid file parameters or unsupported content type'),
    401: errorResponse('Unauthorized'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/files/{id}/confirm',
  summary: 'Confirm uploaded file',
  description:
    'Verifies that the object exists in S3, marks file as READY, and queues background virus/thumbnail processing.',
  tags: ['Files'],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: fileIdParamDto,
  },
  responses: {
    200: successResponse(FileSchema, 'File confirmed and ready'),
    400: errorResponse('File not found in S3 storage'),
    401: errorResponse('Unauthorized'),
    404: errorResponse('File record not found'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/files/{id}/download-url',
  summary: 'Get S3 presigned download URL',
  description:
    'Generates a short-lived presigned GET URL for downloading the file directly from S3.',
  tags: ['Files'],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: fileIdParamDto,
  },
  responses: {
    200: successResponse(DownloadUrlData, 'Presigned download URL'),
    401: errorResponse('Unauthorized'),
    404: errorResponse('File not found'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/files/{id}',
  summary: 'Delete file',
  description: 'Deletes object from S3 storage and deletes database record.',
  tags: ['Files'],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: fileIdParamDto,
  },
  responses: {
    204: { description: 'File deleted successfully' },
    401: errorResponse('Unauthorized'),
    404: errorResponse('File not found'),
  },
});

// ---------------------------------------------------------------------------
// OpenAPI Document Builder
// ---------------------------------------------------------------------------
export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Node Scalable Foundation API',
      version: '1.0.0',
      description:
        'Production-grade RESTful API with PostgreSQL, Redis caching, BullMQ queues, AWS S3/SES, and WebSockets.',
      contact: {
        name: 'Backend Engineering Team',
      },
    },
    servers: [
      {
        url: '/',
        description: 'Current Environment Server',
      },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication, registration, JWT tokens & password recovery' },
      { name: 'Users', description: 'User profile management & administrative user directory' },
      { name: 'Files', description: 'S3 direct presigned uploads, confirmation & downloads' },
      { name: 'Health', description: 'Operational liveness & readiness health probes' },
    ],
  });
}

export const openApiDocument = generateOpenApiDocument();
