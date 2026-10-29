import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { bearerAuth, errorResponse, successResponse } from '@/docs/helpers';
import {
  listUsersQueryDto,
  updateMeDto,
  updateUserStatusDto,
} from '@/modules/users/users.dto';

export const UserSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }),
  email: z.string().email().openapi({ example: 'jane.doe@example.com' }),
  name: z.string().openapi({ example: 'Jane Doe' }),
  status: z
    .enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'])
    .openapi({ example: 'ACTIVE' }),
  emailVerified: z.boolean().openapi({ example: true }),
  phoneNumber: z.string().nullable().openapi({ example: '+1234567890' }),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime().openapi({ example: '2026-01-15T08:30:00.000Z' }),
  updatedAt: z.string().datetime().openapi({ example: '2026-01-15T08:30:00.000Z' }),
});

export function registerUsersDocs(registry: OpenAPIRegistry): { UserSchema: typeof UserSchema } {
  registry.register('User', UserSchema);

  const UpdateMeInput = registry.register('UpdateMeInput', updateMeDto);
  const UpdateUserStatusInput = registry.register('UpdateUserStatusInput', updateUserStatusDto);

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

  // --- Users Routes ---
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
    path: '/api/v1/platform/users',
    summary: 'List users (Platform Staff)',
    description: 'Returns paginated list of all users. Requires platform_users::read permission.',
    tags: ['Platform Staff'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      query: listUsersQueryDto,
    },
    responses: {
      200: successResponse(PaginatedUsersData, 'Paginated list of users'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden - Platform permission required'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/platform/users/{userId}',
    summary: 'Get user details by ID (Platform Staff)',
    description: 'Returns full profile of specified user. Requires platform_users::read permission.',
    tags: ['Platform Staff'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(UserSchema, 'User profile details'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden - Platform permission required'),
      404: errorResponse('User not found'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/platform/users/{userId}/status',
    summary: 'Update user account status (Platform Staff)',
    description: 'Suspends, activates, or deactivates user account. Requires platform_users::suspend permission.',
    tags: ['Platform Staff'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: UpdateUserStatusInput } } },
    },
    responses: {
      200: successResponse(UserSchema, 'User status updated'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden - Platform permission required'),
      404: errorResponse('User not found'),
    },
  });

  return { UserSchema };
}
