import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { bearerAuth, errorResponse, successResponse } from '@/docs/helpers';
import {
  addTenantGroupMembersDto,
  createGroupDto,
  updateGroupDto,
} from '@/modules/groups/groups.dto';

export const UserGroupSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1111111-2222-3333-4444-555555555555' }),
  name: z.string().openapi({ example: 'Engineering Team' }),
  slug: z.string().openapi({ example: 'engineering-team' }),
  description: z.string().nullable().openapi({ example: 'Core developers and maintainers' }),
  scope: z.enum(['PLATFORM', 'TENANT']).openapi({ example: 'TENANT' }),
  tenantId: z.string().uuid().nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).openapi({ example: 'ACTIVE' }),
  memberCount: z.number().openapi({ example: 5 }),
  createdAt: z.string().datetime().openapi({ example: '2026-02-01T10:00:00.000Z' }),
  updatedAt: z.string().datetime().openapi({ example: '2026-02-01T10:00:00.000Z' }),
});

export const UserGroupMemberSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  status: z.string(),
  joinedGroupAt: z.string().datetime(),
});

export function registerGroupsDocs(registry: OpenAPIRegistry): void {
  registry.register('UserGroup', UserGroupSchema);
  registry.register('UserGroupMember', UserGroupMemberSchema);

  const CreateGroupInput = registry.register('CreateGroupInput', createGroupDto);
  const UpdateGroupInput = registry.register('UpdateGroupInput', updateGroupDto);
  const AddMembersInput = registry.register('AddTenantGroupMembersInput', addTenantGroupMembersDto);

  registry.registerPath({
    method: 'get',
    path: '/api/v1/groups',
    summary: 'List tenant user groups',
    tags: ['User Groups'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(UserGroupSchema), 'User groups retrieved successfully'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Missing groups:read permission'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/groups',
    summary: 'Create a tenant user group',
    tags: ['User Groups'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: CreateGroupInput } } },
    },
    responses: {
      201: successResponse(UserGroupSchema, 'User group created successfully'),
      400: errorResponse('Validation error'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Missing groups:create permission'),
      409: errorResponse('Slug conflict'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/groups/{groupId}',
    summary: 'Get tenant user group by ID',
    tags: ['User Groups'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(UserGroupSchema, 'User group retrieved successfully'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('User group not found'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/groups/{groupId}',
    summary: 'Update tenant user group',
    tags: ['User Groups'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: UpdateGroupInput } } },
    },
    responses: {
      200: successResponse(UserGroupSchema, 'User group updated successfully'),
      400: errorResponse('Validation error'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('User group not found'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/groups/{groupId}',
    summary: 'Archive tenant user group',
    tags: ['User Groups'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(UserGroupSchema, 'User group archived successfully'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('User group not found'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/groups/{groupId}/members',
    summary: 'List tenant group members',
    tags: ['User Groups'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(UserGroupMemberSchema), 'Group members retrieved successfully'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('User group not found'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/groups/{groupId}/members',
    summary: 'Add members to tenant user group',
    tags: ['User Groups'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: AddMembersInput } } },
    },
    responses: {
      200: successResponse(z.object({ addedCount: z.number() }), 'Members added successfully'),
      400: errorResponse('One or more users are not active workspace members'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('User group not found'),
    },
  });
}

