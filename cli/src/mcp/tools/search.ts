import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

const SearchSchema = z.object({
  query: z.string().describe('Search query (FTS5 full-text search)'),
  space: z.string().optional().describe('Filter by space name'),
  tag: z.string().optional().describe('Filter by tag'),
  tier: z.number().int().min(1).max(4).optional().describe('Filter by tier (1-4)'),
});

const StatusSchema = z.object({
  space: z.string().optional().describe('Space name for specific status, or omit for global status'),
});

export function createSearchTools(store: MindStore) {
  return {
    search: {
      schema: SearchSchema,
      handler: async (args: z.infer<typeof SearchSchema>) => {
        const results = await store.search(args.query, {
          space: args.space,
          tag: args.tag,
          tier: args.tier as Tier | undefined,
        });
        
        return {
          content: [{ type: 'text', text: `Found ${results.length} result(s) for "${args.query}".` }],
          results,
        };
      },
    },
    status: {
      schema: StatusSchema,
      handler: async (args: z.infer<typeof StatusSchema>) => {
        const status = store.getStatus(args.space);
        
        return {
          content: [{ 
            type: 'text', 
            text: args.space 
              ? `Status for space "${args.space}" retrieved.` 
              : `Global mind status retrieved.` 
          }],
          status,
        };
      },
    },
  };
}
