import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

const SearchSchema = z.object({
    query: z.string().min(1).describe('Search query using FTS5 syntax. Supports: quoted phrases ("exact match"), AND/OR/NOT operators, prefix matching (bug*).'),
    space: z.string().optional().describe('Limit search to a specific space.'),
    tag: z.string().optional().describe('Filter by tag.'),
    tier: z.number().int().min(1).max(4).optional().describe('Filter by tier: 1, 2, 3, 4.'),
});

const StatusSchema = z.object({
    space: z.string().optional().describe('Space name for space-specific status.'),
});

const SEARCH_TOOL_DESCRIPTIONS: Record<string, string> = {
    search: 'Full-text search across all memories including T4 frozen ones. Use FTS5 syntax (e.g., "auth AND jwt", "bug*"). This is the only way to find T4 archived memories.',
    status: 'Get storage status: memory counts per tier, space usage, and link totals. Use to understand current storage state before cleanup or reorganization.',
};

export function createSearchTools(store: MindStore) {
    return {
        search: {
            schema: SearchSchema,
            description: SEARCH_TOOL_DESCRIPTIONS.search,
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (args: unknown) => {
                const parsed = SearchSchema.parse(args ?? {});
                if (!parsed.query) {
                    throw new Error('Search query is required.');
                }
                const results = await store.search(parsed.query, {
                    space: parsed.space,
                    tag: parsed.tag,
                    tier: parsed.tier as Tier | undefined,
                });

                return {
                    content: [{ type: 'text', text: `Found ${results.length} result(s) for "${parsed.query}".` }],
                    results,
                };
            },
        },
        status: {
            schema: StatusSchema,
            description: SEARCH_TOOL_DESCRIPTIONS.status,
            annotations: { readOnlyHint: true },
            handler: async (args: unknown) => {
                const parsed = StatusSchema.parse(args ?? {});
                const status = store.getStatus(parsed.space);

                return {
                    content: [
                        {
                            type: 'text',
                            text: parsed.space
                                ? `Status for space "${parsed.space}" retrieved.`
                                : `Global mind status retrieved.`,
                        },
                    ],
                    status,
                };
            },
        },
    };
}
