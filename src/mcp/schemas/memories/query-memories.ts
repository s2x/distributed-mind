import { z } from 'zod';

export const MemoryQuerySchema = z.object({
  space: z.string().min(1).describe('Space to query. Use "*" for all spaces.'),
  search: z
    .string()
    .optional()
    .describe(
      'Search query using FTS5 syntax. When provided, performs full-text search on name and content.'
    ),
  tag: z.string().optional().describe('Filter by tag.'),
  tier: z
    .number()
    .int()
    .min(1)
    .max(3)
    .nullable()
    .optional()
    .describe('Filter by tier: 1, 2, 3, or null. Null means all tiers.'),
  from: z.string().optional().describe('Changed date lower bound (YYYY-MM-DD).'),
  to: z.string().optional().describe('Changed date upper bound (YYYY-MM-DD).'),
  limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25).'),
  offset: z.number().int().min(0).optional().describe('Zero-based offset (default: 0).'),
});
