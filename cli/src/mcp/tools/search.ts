import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

const SearchSchema = z.object({
  query: z.string().describe('**Required.** Search query using FTS5 full-text search. Supports: single words, phrases, AND ("fix AND bug"), OR ("error OR warning"), prefix ("config*"). Use specific terms for better results.'),
  space: z.string().optional().describe('Optional. Limit search to a specific space. Example: "projects/mind". Default: searches all spaces.'),
  tag: z.string().optional().describe('Optional. Filter by tag. Example: "cat:decision" searches only memories with that tag.'),
  tier: z.number().int().min(1).max(4).optional().describe('Optional. Filter by tier: 1 (hot), 2 (warm), 3 (cold), 4 (frozen). Default: all tiers including frozen (T4).'),
});

const StatusSchema = z.object({
  space: z.string().optional().describe('Optional. Space name for space-specific status. Omit for global status showing all spaces. Space status shows tier breakdown (T1/T2/T3/T4 counts and limits).'),
});

const SEARCH_TOOL_DESCRIPTIONS: Record<string, string> = {
  search: 'Full-text search across all memories (including T4 frozen). Supports FTS5 syntax.',
  status: 'Get storage status: global or per-space (tier counts, limits, memory count).',
};

export function createSearchTools(store: MindStore) {
  return {
    search: {
      schema: SearchSchema,
      description: SEARCH_TOOL_DESCRIPTIONS.search,
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
      description: SEARCH_TOOL_DESCRIPTIONS.status,
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
