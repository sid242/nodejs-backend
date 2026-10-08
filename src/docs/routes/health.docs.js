import { z } from 'zod';

export function registerHealthDocs(registry) {
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
}
