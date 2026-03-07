import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

const MemoryAddSchema = z.object({
    space: z
        .string()
        .describe(
            '**Required.** Space to add memory to. Must exist — create with space_create first. Examples: projects/mind, user/preferences, sessions/mind.'
        ),
    name: z
        .string()
        .describe(
            '**Required.** Memory name/title. Use descriptive, searchable names. Example: "JWT auth implementation", "Fixed N+1 query".'
        ),
    content: z
        .string()
        .describe(
            '**Required.** Memory content. See system_instructions for recommended format (**What**, **Why**, **Where**, **Learned**).'
        ),
    tags: z
        .array(z.string())
        .optional()
        .describe(
            'Optional tags. Use: cat:decision, cat:bugfix, cat:pattern, cat:discovery, cat:preference, cat:config. List existing tags first to avoid duplicates.'
        ),
    tier: z
        .number()
        .int()
        .min(1)
        .max(3)
        .optional()
        .describe('Optional. Tier: 1=hot (max 25), 2=warm (default, max 50), 3=cold (max 100). Omit for default (T2).'),
});

const MemoryGetSchema = z.object({
    space: z.string().describe('**Required.** Space containing the memory. Must exist.'),
    name: z.string().describe('**Required.** Memory name to retrieve. Case-sensitive.'),
});

const MemoryGetByIdSchema = z.object({
    id: z
        .number()
        .describe('**Required.** Memory ID (numeric). Get IDs from memory_list, memory_query, or search results.'),
});

const MemoryListSchema = z.object({
    space: z.string().describe('**Required.** Space to list memories from. Must exist.'),
    tier: z
        .number()
        .int()
        .min(1)
        .max(4)
        .optional()
        .describe('Optional. Filter by tier: 1 (hot), 2 (warm), 3 (cold), 4 (frozen). Default: lists T1+T2.'),
    tag: z.string().optional().describe('Optional. Filter by tag. Example: "cat:decision".'),
});

const MemoryUpdateSchema = z.object({
    id: z.number().describe('**Required.** Memory ID to update. Get ID from memory_list, memory_query, or search.'),
    name: z.string().optional().describe('Optional. New memory name. If omitted, keeps current name.'),
    content: z
        .string()
        .optional()
        .describe(
            'Optional. New content. If omitted, keeps current content. Note: Updating content updates the changed_at timestamp.'
        ),
});

const MemoryDeleteSchema = z.object({
    space: z.string().describe('**Required.** Space containing the memory. Must exist.'),
    name: z
        .string()
        .describe('**Required.** Memory name to delete. Case-sensitive. This is PERMANENT — there is no undo.'),
});

const MemoryReadSchema = z.object({
    space: z.string().describe('**Required.** Space containing the memory. Must exist.'),
    name: z
        .string()
        .describe(
            '**Required.** Memory name to read. Case-sensitive. Reading: 1) Returns content, 2) Records access, 3) Auto-promotes one tier up unless pinned or at T1.'
        ),
});

const MemoryTagAddSchema = z.object({
    memoryId: z.number().describe('**Required.** Memory ID to tag. Get ID from memory_list, memory_query, or search.'),
    tag: z
        .string()
        .describe(
            '**Required.** Tag to add. List existing tags first with memory_tags_list to avoid duplicates. Recommended: cat:decision, cat:bugfix, cat:pattern, cat:discovery, cat:preference, cat:config.'
        ),
});

const MemoryTagRemoveSchema = z.object({
    memoryId: z.number().describe('**Required.** Memory ID to untag.'),
    tag: z.string().describe('**Required.** Tag to remove from the memory.'),
});

const MemoryTagsListSchema = z.object({});

const MemoryQuerySchema = z.object({
    space: z
        .string()
        .optional()
        .describe('Optional. Filter by space name. Example: "projects/mind" or "user/preferences".'),
    tag: z.string().optional().describe('Optional. Filter by tag (do not include #). Example: "cat:decision".'),
    tier: z
        .number()
        .int()
        .min(1)
        .max(4)
        .optional()
        .describe('Optional. Filter by tier: 1 (hot), 2 (warm), 3 (cold), 4 (frozen).'),
    from: z
        .string()
        .optional()
        .describe('Optional. Changed date lower bound. Format: "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" or ISO datetime.'),
    to: z.string().optional().describe('Optional. Changed date upper bound. Format: same as from.'),
    limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe('Optional. Number of results per page. Default: 25. Max: 500.'),
    offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Optional. Zero-based offset for pagination. Default: 0. Use offset + limit for next page.'),
});

const MEMORY_TOOL_DESCRIPTIONS: Record<string, string> = {
    memory_add: 'Add a new memory to a space. Space must exist first.',
    memory_get: 'Get a memory by space name and memory name.',
    memory_get_by_id: 'Get a memory by its numeric ID.',
    memory_list: 'List memories in a space, optionally filtered by tier or tag.',
    memory_update: 'Update a memory name or content by ID.',
    memory_delete: 'Delete a memory PERMANENTLY by space and name.',
    memory_read: 'Read a memory (returns content + auto-promotes tier).',
    memory_tag_add: 'Add a tag to a memory by ID.',
    memory_tag_remove: 'Remove a tag from a memory by ID.',
    memory_tags_list: 'List all tags in the system (both spaces and memories).',
    memory_query: 'Query memories with filters (space, tag, tier, date range) and pagination.',
};

export function createMemoryTools(store: MindStore) {
    return {
        memory_add: {
            schema: MemoryAddSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_add,
            handler: async (args: z.infer<typeof MemoryAddSchema>) => {
                const memory = await store.addMemory(args.space, args.name, args.content, {
                    tags: args.tags,
                    tier: args.tier as Tier | undefined,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Memory "${args.name}" added to space "${args.space}" (T${memory.tier}).`,
                        },
                    ],
                    memory,
                };
            },
        },
        memory_get: {
            schema: MemoryGetSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_get,
            handler: async (args: z.infer<typeof MemoryGetSchema>) => {
                const memory = store.getMemory(args.space, args.name);
                if (!memory) {
                    throw new Error(`Memory "${args.name}" not found in space "${args.space}".`);
                }
                return {
                    content: [{ type: 'text', text: `Memory: ${memory.name} (T${memory.tier})` }],
                    memory,
                };
            },
        },
        memory_get_by_id: {
            schema: MemoryGetByIdSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_get_by_id,
            handler: async (args: z.infer<typeof MemoryGetByIdSchema>) => {
                const memory = store.getMemoryById(args.id);
                if (!memory) {
                    throw new Error(`Memory with ID ${args.id} not found.`);
                }
                return {
                    content: [{ type: 'text', text: `Memory: ${memory.name} (T${memory.tier})` }],
                    memory,
                };
            },
        },
        memory_list: {
            schema: MemoryListSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_list,
            handler: async (args: z.infer<typeof MemoryListSchema>) => {
                const memories = store.listMemories(args.space, {
                    tier: args.tier as Tier | undefined,
                    tag: args.tag,
                });
                return {
                    content: [
                        { type: 'text', text: `Found ${memories.length} memory/memories in space "${args.space}".` },
                    ],
                    memories,
                };
            },
        },
        memory_update: {
            schema: MemoryUpdateSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_update,
            handler: async (args: z.infer<typeof MemoryUpdateSchema>) => {
                await store.updateMemory(args.id, { name: args.name, content: args.content });
                const memory = store.getMemoryById(args.id);
                return {
                    content: [{ type: 'text', text: `Memory updated successfully.` }],
                    memory,
                };
            },
        },
        memory_delete: {
            schema: MemoryDeleteSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_delete,
            handler: async (args: z.infer<typeof MemoryDeleteSchema>) => {
                store.deleteMemoryByName(args.space, args.name);
                return {
                    content: [{ type: 'text', text: `Memory "${args.name}" deleted from space "${args.space}".` }],
                };
            },
        },
        memory_read: {
            schema: MemoryReadSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_read,
            handler: async (args: z.infer<typeof MemoryReadSchema>) => {
                const memory = store.getMemory(args.space, args.name);
                if (!memory) {
                    throw new Error(`Memory "${args.name}" not found in space "${args.space}".`);
                }
                store.recordAccess(memory.id);
                const updatedMemory = store.getMemoryById(memory.id);
                return {
                    content: [{ type: 'text', text: `Memory "${args.name}" read. Auto-promoted if applicable.` }],
                    memory: updatedMemory,
                };
            },
        },
        memory_tag_add: {
            schema: MemoryTagAddSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_tag_add,
            handler: async (args: z.infer<typeof MemoryTagAddSchema>) => {
                const allTags = store.listAllTags();
                const existingTags = allTags.memories.map((t) => t.tag);

                store.addMemoryTag(args.memoryId, args.tag);
                const memory = store.getMemoryById(args.memoryId);
                return {
                    content: [{ type: 'text', text: `Tag "${args.tag}" added to memory.` }],
                    memory,
                    existingTagsInSystem: existingTags,
                    note: 'Check existingTagsInSystem to avoid creating duplicate tags in the future.',
                };
            },
        },
        memory_tag_remove: {
            schema: MemoryTagRemoveSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_tag_remove,
            handler: async (args: z.infer<typeof MemoryTagRemoveSchema>) => {
                store.removeMemoryTag(args.memoryId, args.tag);
                const memory = store.getMemoryById(args.memoryId);
                return {
                    content: [{ type: 'text', text: `Tag "${args.tag}" removed from memory.` }],
                    memory,
                };
            },
        },
        memory_tags_list: {
            schema: MemoryTagsListSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_tags_list,
            handler: async () => {
                const tags = store.listAllTags();
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Found ${tags.spaces.length} space tags and ${tags.memories.length} memory tags.`,
                        },
                    ],
                    tags,
                };
            },
        },
        memory_query: {
            schema: MemoryQuerySchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_query,
            handler: async (args: z.infer<typeof MemoryQuerySchema>) => {
                const limit = args.limit ?? 25;
                const offset = args.offset ?? 0;
                const memories = store.queryMemories({
                    space: args.space,
                    tag: args.tag,
                    tier: args.tier as Tier | undefined,
                    from: args.from,
                    to: args.to,
                    limit,
                    offset,
                });

                const nextOffset = memories.length === limit ? offset + limit : null;

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Found ${memories.length} memory result(s). Pagination: limit=${limit}, offset=${offset}, next_offset=${nextOffset ?? 'N/A'}.`,
                        },
                    ],
                    items: memories,
                    pagination: {
                        limit,
                        offset,
                        nextOffset,
                    },
                    filtersApplied: {
                        space: args.space ?? null,
                        tag: args.tag ?? null,
                        tier: args.tier ?? null,
                        from: args.from ?? null,
                        to: args.to ?? null,
                    },
                };
            },
        },
    };
}
