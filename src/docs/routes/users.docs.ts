import { z } from 'zod';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { updateMeDto, listUsersQueryDto } from '@/modules/users/users.dto.js';
import { bearerAuth, errorResponse, successResponse } from '@/docs/helpers.js';

export const UserSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }),
  email: z.string().email().openapi({ example: 'jane.doe@example.com' }),
  name: z.string().openapi({ example: 'Jane Doe' }),
  role: z.enum(['USER', 'ADMIN']).openapi({ example: 'USER' }),
  emailVerified: z.boolean().openapi({ example: true }),
  createdAt: z.string().datetime().openapi({ example: '2026-01-15T08:30:00.000Z' }),
  updatedAt: z.string().datetime().openapi({ example: '2026-01-15T08:30:00.000Z' }),
});

export function registerUsersDocs(registry: OpenAPIRegistry): { UserSchema: typeof UserSchema } {
  registry.register('User', UserSchema);

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

  return { UserSchema };
}
