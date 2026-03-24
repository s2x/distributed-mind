import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

const SearchSchema = z.object({
    query: z.string().min(1).describe('Search query using FTS5 syntax. Supports: quoted phrases ("exact match"), AND/OR/NOT operators, prefix matching (bug*).'),
    space: z.string().min(1).describe('Space to search in. Use "*" for all spaces.'),
    tag: z.string().optional().describe('Filter by tag.'),
    tier: z.number().int().min(1).max(4).optional().describe('Filter by tier: 1, 2, 3, 4.'),
});

const MemoryQuerySchema = z.object({
    space: z.string().min(1).describe('Space to query. Use "*" for all spaces.'),
    tag: z.string().optional().describe('Filter by tag.'),
    tier: z.number().int().min(1).max(4).optional().describe('Filter by tier: 1, 2, 3, 4.'),
    from: z.string().optional().describe('Changed date lower bound (YYYY-MM-DD).'),
    to: z.string().optional().describe('Changed date upper bound (YYYY-MM-DD).'),
    limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25).'),
    offset: z.number().int().min(0).optional().describe('Zero-based offset (default: 0).'),
});

const StatusSchema = z.object({
    space: z.string().optional().describe('Space name for space-specific status.'),
});

const SEARCH_TOOL_DESCRIPTIONS: Record<string, string> = {
    search: 'Full-text search across all memories including T4 frozen ones. Use FTS5 syntax (e.g., "auth AND jwt", "bug*"). This is the only way to find T4 archived memories. Space is required; use "*" for all spaces.',
    memory_query: 'Query memories by metadata/date with pagination. Always includes T4 frozen memories. Use space="*" for all spaces. Supports filtering by tag, tier, and date range.',
    status: 'Get storage status: memory counts per tier, space usage, and link totals. Use to understand current storage state before cleanup or reorganization.',
};

// ── Search query parser ──
// Translates flexible search syntax to FTS5-compatible query:
// - "exact phrase" → FTS5 phrase
// - word1 word2 → AND implicit
// - word1 OR word2 → OR
// - word1 AND word2 → AND explicit
// - -word → NOT
// - prefix* → FTS5 prefix
// - (expr) → parens preserved

export function parseSearchQuery(input: string): string {
    return input;
}

export function createSearchTools(store: MindStore) {
    return {
        search: {
            schema: SearchSchema,
            description: SEARCH_TOOL_DESCRIPTIONS.search,
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (args: unknown) => {
                let parsed;
                try {
                    parsed = SearchSchema.parse(args ?? {});
                } catch (e: any) {
                    // Provide cleaner validation errors
                    if (e.issues?.length) {
                        const spaceError = e.issues.find((err: any) => err.path?.includes('space'));
                        if (spaceError) {
                            throw new Error('space is required');
                        }
                    }
                    throw e;
                }

                // space === "*" means all spaces (don't filter)
                const spaceFilter = parsed.space === '*' ? undefined : parsed.space;

                // Use searchFallback if available, otherwise fall back to searchMemories
                let results: any[];
                let search_method: string;

                if (typeof (store as any).searchFallback === 'function') {
                    const fallbackResult = await (store as any).searchFallback(parsed.query, {
                        space: spaceFilter,
                        tag: parsed.tag,
                        tier: parsed.tier as Tier | undefined,
                    });
                    results = fallbackResult.results;
                    search_method = fallbackResult.search_method;
                } else {
                    // Fall back to plain searchMemories
                    results = await store.search(parsed.query, {
                        space: spaceFilter,
                        tag: parsed.tag,
                        tier: parsed.tier as Tier | undefined,
                    });
                    search_method = 'fts5';
                }

                return {
                    content: [{ type: 'text', text: `Found ${results.length} result(s) for "${parsed.query}".` }],
                    results: results.map(({ id, ...rest }: any) => rest),
                    search_method,
                };
            },
        },

        memory_query: {
            schema: MemoryQuerySchema,
            description: SEARCH_TOOL_DESCRIPTIONS.memory_query,
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (args: unknown) => {
                let parsed;
                try {
                    parsed = MemoryQuerySchema.parse(args ?? {});
                } catch (e: any) {
                    // Provide cleaner validation errors
                    if (e.issues?.length) {
                        const spaceError = e.issues.find((err: any) => err.path?.includes('space'));
                        if (spaceError) {
                            throw new Error('space is required');
                        }
                    }
                    throw e;
                }

                // space === "*" means all spaces (don't filter)
                const spaceFilter = parsed.space === '*' ? undefined : parsed.space;

                const memories = store.queryMemories({
                    space: spaceFilter,
                    tag: parsed.tag,
                    tier: parsed.tier as Tier | undefined,
                    from: parsed.from,
                    to: parsed.to,
                    limit: parsed.limit ?? 25,
                    offset: parsed.offset ?? 0,
                });

                // Get total count (without pagination) for pagination info
                const totalFiltered = store.queryMemories({
                    space: spaceFilter,
                    tag: parsed.tag,
                    tier: parsed.tier as Tier | undefined,
                    from: parsed.from,
                    to: parsed.to,
                    limit: 10000, // large number to get all
                    offset: 0,
                });

                return {
                    content: [{ type: 'text', text: `Found ${memories.length} memory/memories (total: ${totalFiltered.length}).` }],
                    memories: memories.map(({ id, ...rest }) => rest),
                    total: totalFiltered.length,
                    limit: parsed.limit ?? 25,
                    offset: parsed.offset ?? 0,
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
