import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { bearerAuth, errorResponse, successResponse } from '@/docs/helpers';
import { searchQueryDto } from '@/modules/search/search.dto';

export function registerSearchDocs(registry: OpenAPIRegistry): void {
  const SearchItemSchema = registry.register(
    'SearchItem',
    z.object({
      id: z.string().openapi({ example: 'member-11111111-1111-4111-8111-111111111111' }),
      title: z.string().openapi({ example: 'Sarah Connor' }),
      subtitle: z
        .string()
        .nullable()
        .optional()
        .openapi({ example: 'Admin · Engineering · sarah@acme.com' }),
      category: z
        .enum(['Pages', 'Actions', 'Members', 'Files', 'Roles', 'Groups', 'Templates'])
        .openapi({ example: 'Members' }),
      href: z.string().openapi({ example: '/team?search=sarah%40acme.com' }),
      icon: z.string().optional().openapi({ example: 'user' }),
      metadata: z.record(z.unknown()).optional(),
    }),
  );

  const SearchResultSchema = registry.register(
    'SearchResult',
    z.object({
      query: z.string().openapi({ example: 'sarah' }),
      total: z.number().openapi({ example: 1 }),
      results: z.array(SearchItemSchema),
    }),
  );

  registry.registerPath({
    method: 'get',
    path: '/api/v1/search',
    summary: 'Global workspace search',
    description:
      'Fast unified command-palette search across members, files, roles, groups, templates, and actions.',
    tags: ['Search'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      query: searchQueryDto,
    },
    responses: {
      200: successResponse(SearchResultSchema, 'Search results matching query'),
      401: errorResponse('Unauthorized'),
    },
  });
}
