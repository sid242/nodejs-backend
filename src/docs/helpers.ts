import { z } from 'zod';
import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ---------------------------------------------------------------------------
// Security Schemes
// ---------------------------------------------------------------------------
export const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
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

export function successResponse(schema: z.ZodTypeAny, description = 'Successful operation') {
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

export function errorResponse(description = 'Error response') {
  return {
    description,
    content: {
      'application/json': {
        schema: ErrorEnvelope,
      },
    },
  };
}
