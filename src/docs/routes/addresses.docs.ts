import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { bearerAuth, errorResponse, successResponse } from '@/docs/helpers';
import { ADDRESS_TYPES } from '@/modules/addresses/addresses.dto';

export function registerAddressesDocs(registry: OpenAPIRegistry): void {
  const AddressSchema = registry.register(
    'Address',
    z.object({
      id: z.string().uuid().openapi({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
      ownerType: z.enum(['USER', 'TENANT', 'MEMBER']).openapi({ example: 'USER' }),
      ownerId: z.string().uuid(),
      tenantId: z.string().uuid().nullable(),
      type: z.enum(ADDRESS_TYPES).openapi({ example: 'HOME' }),
      label: z.string().nullable().optional(),
      isDefault: z.boolean().openapi({ example: true }),
      recipientName: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      line1: z.string().openapi({ example: '101, Business Park' }),
      line2: z.string().nullable().optional(),
      landmark: z.string().nullable().optional(),
      postalCode: z.string().nullable().optional().openapi({ example: '380006' }),
      countryCode: z.string().openapi({ example: 'IN' }),
      stateGeoId: z.number().nullable().optional(),
      districtGeoId: z.number().nullable().optional(),
      subdistrictGeoId: z.number().nullable().optional(),
      localityGeoId: z.number().nullable().optional(),
      localityKind: z.string().nullable().optional(),
      areaGeoId: z.number().nullable().optional(),
      stateName: z.string().nullable().optional(),
      districtName: z.string().nullable().optional(),
      subdistrictName: z.string().nullable().optional(),
      localityName: z.string().nullable().optional(),
      areaName: z.string().nullable().optional(),
      latitude: z.string().nullable().optional(),
      longitude: z.string().nullable().optional(),
      createdAt: z.date(),
      updatedAt: z.date(),
    }),
  );

  // User endpoints
  registry.registerPath({
    method: 'get',
    path: '/api/v1/addresses/me',
    summary: 'List personal user addresses',
    tags: ['Addresses'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(AddressSchema), 'List of user addresses'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/addresses/workspace',
    summary: 'List workspace addresses',
    tags: ['Addresses'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(AddressSchema), 'List of workspace addresses'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
    },
  });
}

