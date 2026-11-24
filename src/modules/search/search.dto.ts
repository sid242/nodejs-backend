import { z } from 'zod';

export const SEARCH_CATEGORIES = [
  'pages',
  'actions',
  'members',
  'files',
  'roles',
  'groups',
  'templates',
] as const;

export type SearchCategory = (typeof SEARCH_CATEGORIES)[number];

export const searchQueryDto = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  types: z
    .string()

    .transform((val) =>
      val
        ? val
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter((s): s is SearchCategory => SEARCH_CATEGORIES.includes(s as SearchCategory))
        : undefined,
    )
    .optional(),
});

export type SearchQueryDto = z.infer<typeof searchQueryDto>;

export const searchItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  category: z.enum(['Pages', 'Actions', 'Members', 'Files', 'Roles', 'Groups', 'Templates']),
  href: z.string(),
  icon: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SearchItem = z.infer<typeof searchItemSchema>;

export interface SearchResult {
  query: string;
  total: number;
  results: SearchItem[];
}
