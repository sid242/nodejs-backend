import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { bearerAuth, errorResponse, successResponse } from '@/docs/helpers';
import { getChildrenQueryDto, lookupQueryDto, pinParamDto } from '@/modules/geo/geo.dto';

export function registerGeoDocs(registry: OpenAPIRegistry): void {
  const GeoItemSchema = registry.register(
    'GeoItem',
    z.object({
      id: z.number().openapi({ example: 24 }),
      name: z.string().openapi({ example: 'Gujarat' }),
      code: z.string().nullable().optional().openapi({ example: 'GJ' }),
      levelId: z.number().optional().openapi({ example: 2 }),
    }),
  );

  const PinDetailsSchema = registry.register(
    'PinDetails',
    z.object({
      pin: z.string().openapi({ example: '380006' }),
      area: GeoItemSchema,
      state: GeoItemSchema.nullable(),
      district: GeoItemSchema.nullable(),
      subdistrict: GeoItemSchema.nullable(),
      chain: z.array(z.any()),
    }),
  );

  registry.registerPath({
    method: 'get',
    path: '/api/v1/geo/states',
    summary: 'List Indian States & Union Territories',
    description: 'Returns all active states and UTs in India.',
    tags: ['Geo'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(GeoItemSchema), 'List of states'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/geo/children',
    summary: 'List child locations',
    description: 'Returns child entities (districts, sub-districts, cities, villages) under a parent geo ID.',
    tags: ['Geo'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      query: getChildrenQueryDto,
    },
    responses: {
      200: successResponse(z.array(GeoItemSchema), 'List of child geo items'),
      400: errorResponse('Bad Request'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/geo/pincode/{pin}',
    summary: 'Resolve PIN Code',
    description: 'Looks up an Indian 6-digit PIN code and resolves its administrative hierarchy.',
    tags: ['Geo'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: pinParamDto,
    },
    responses: {
      200: successResponse(PinDetailsSchema, 'PIN details and resolved ancestor chain'),
      404: errorResponse('PIN code not found'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/geo/lookup',
    summary: 'Reverse geocode coordinates',
    description: 'Resolves GPS latitude and longitude to Indian administrative entities.',
    tags: ['Geo'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      query: lookupQueryDto,
    },
    responses: {
      200: successResponse(z.array(z.any()), 'Resolved location levels for coordinates'),
      401: errorResponse('Unauthorized'),
    },
  });
}

