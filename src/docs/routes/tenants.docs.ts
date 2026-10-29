import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { bearerAuth, errorResponse, successResponse } from '@/docs/helpers';
import { addMemberDto, createTenantDto, updateTenantDto } from '@/modules/tenants/tenants.dto';

export const TenantSchema = z.object({
  id: z.string().uuid().openapi({ example: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' }),
  name: z.string().openapi({ example: 'Acme Corp' }),
  slug: z.string().openapi({ example: 'acme-corp' }),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'TRIALING', 'DEACTIVATED']).openapi({ example: 'ACTIVE' }),
  plan: z.string().openapi({ example: 'FREE' }),
  createdAt: z.string().datetime().openapi({ example: '2026-01-15T08:30:00.000Z' }),
});

export const TenantMemberSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  status: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED']),
  joinedAt: z.string().datetime(),
});

export function registerTenantsDocs(registry: OpenAPIRegistry): void {
  registry.register('Tenant', TenantSchema);
  registry.register('TenantMember', TenantMemberSchema);

  const CreateTenantInput = registry.register('CreateTenantInput', createTenantDto);
  const UpdateTenantInput = registry.register('UpdateTenantInput', updateTenantDto);
  const AddMemberInput = registry.register('AddMemberInput', addMemberDto);

  registry.registerPath({
    method: 'post',
    path: '/api/v1/tenants',
    summary: 'Create a new tenant organization',
    description: 'Provisions a new tenant and sets the caller as OWNER with full permissions.',
    tags: ['Tenants'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: CreateTenantInput } } },
    },
    responses: {
      201: successResponse(TenantSchema, 'Tenant created successfully'),
      400: errorResponse('Validation error'),
      401: errorResponse('Unauthorized'),
      409: errorResponse('Tenant slug conflict'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/tenants',
    summary: 'List user tenants',
    description: 'Returns all tenants where the authenticated user is an active member.',
    tags: ['Tenants'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(TenantSchema), 'User tenants list'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/tenants/{tenantId}',
    summary: 'Get tenant details',
    tags: ['Tenants'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(TenantSchema, 'Tenant details'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Tenant not found'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/tenants/{tenantId}',
    summary: 'Update tenant organization',
    description: 'Updates tenant organization settings such as display name.',
    tags: ['Tenants'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: UpdateTenantInput } } },
    },
    responses: {
      200: successResponse(TenantSchema, 'Tenant updated successfully'),
      400: errorResponse('Validation error'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Tenant not found'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/tenants/{tenantId}/members',
    summary: 'List tenant members',
    tags: ['Tenants'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(TenantMemberSchema), 'Tenant members list'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/tenants/{tenantId}/members',
    summary: 'Add or invite member to tenant',
    tags: ['Tenants'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: AddMemberInput } } },
    },
    responses: {
      201: successResponse(TenantMemberSchema, 'Member added successfully'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      409: errorResponse('User already a member'),
    },
  });
}
