import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

const MemoryAddSchema = z.object({
    space: z.string().min(1).describe('Space to add memory to. Must exist first.'),
    name: z.string().min(1).describe('Memory name/title.'),
    content: z.string().min(1).describe('Memory content.'),
    tags: z.array(z.string()).optional().describe('Optional tags.'),
    tier: z.number().int().min(1).max(3).optional().describe('Optional tier: 1=hot, 2=warm, 3=cold.'),
    pinned: z.boolean().optional().describe('Optional pinned state. true keeps memory immune to auto-promotion and LRU eviction.'),
    links_to_ids: z
        .array(z.number().int())
        .optional()
        .describe(
            'IDs of existing memories this one relates to. Creates directional links (new → target). Use when this memory depends on, extends, or is caused by another. Get IDs from memory_list or memory_query.'
        ),
});

const MemoryGetSchema = z.object({
    space: z.string().min(1).describe('Space containing the memory.'),
    name: z.string().min(1).describe('Memory name to retrieve.'),
});

const MemoryGetByIdSchema = z.object({
    id: z.number().describe('Memory ID (numeric).'),
});

const MemoryListSchema = z.object({
    space: z.string().min(1).describe('Space to list memories from.'),
    tier: z.number().int().min(1).max(4).optional().describe('Filter by tier: 1, 2, 3, 4.'),
    tag: z.string().optional().describe('Filter by tag.'),
});

const MemoryUpdateSchema = z.object({
    id: z.number().describe('Memory ID to update.'),
    name: z.string().optional().describe('New memory name.'),
    content: z.string().optional().describe('New content.'),
});

const MemoryDeleteSchema = z.object({
    space: z.string().min(1).describe('Space containing the memory.'),
    name: z.string().min(1).describe('Memory name to delete.'),
});

const MemoryReadSchema = z.object({
    space: z.string().min(1).describe('Space containing the memory.'),
    name: z.string().min(1).describe('Memory name to read.'),
});

const MemoryTagAddSchema = z.object({
    memoryId: z.number().describe('Memory ID to tag.'),
    tag: z.string().min(1).describe('Tag to add.'),
});

const MemoryTagRemoveSchema = z.object({
    memoryId: z.number().describe('Memory ID to untag.'),
    tag: z.string().min(1).describe('Tag to remove.'),
});

const MemoryTagsListSchema = z.object({});

const MemoryPatchSchema = z.object({
    id: z.number().int().describe('Memory ID to patch.'),
    name: z.string().optional().describe('Optional new memory name.'),
    content: z.string().optional().describe('Optional new memory content.'),
    pinned: z.boolean().optional().describe('Optional pinned state update.'),
    tier_transition: z
        .enum(['promote', 'demote'])
        .optional()
        .describe('Optional bounded tier transition: promote (up one) or demote (down one).'),
    add_tags: z.array(z.string()).optional().describe('Optional tags to add.'),
    remove_tags: z.array(z.string()).optional().describe('Optional tags to remove.'),
    add_links_to_ids: z
        .array(z.number().int())
        .optional()
        .describe('IDs of memories to link TO from this memory. Use when you discover a new relationship between existing memories.'),
    remove_links_to_ids: z
        .array(z.number().int())
        .optional()
        .describe('IDs of memories to unlink FROM this memory. Removes outgoing links only.'),
});

const MemoryQuerySchema = z.object({
    space: z.string().optional().describe('Filter by space name.'),
    tag: z.string().optional().describe('Filter by tag.'),
    tier: z.number().int().min(1).max(4).optional().describe('Filter by tier.'),
    from: z.string().optional().describe('Changed date lower bound. Format: YYYY-MM-DD.'),
    to: z.string().optional().describe('Changed date upper bound.'),
    limit: z.number().int().min(1).max(500).optional().describe('Page size. Default: 25.'),
    offset: z.number().int().min(0).optional().describe('Zero-based offset. Default: 0.'),
});

const MEMORY_TOOL_DESCRIPTIONS: Record<string, string> = {
    memory_add:
        'Add a new memory to a space. Use immediately after important events: decisions, bug fixes, discoveries, config changes. Supports creating links to related memories via links_to_ids — always link when the new memory depends on or extends an existing one.',
    memory_get: 'Get a memory by space name and memory name. Returns metadata only, does not affect tier. Use memory_read instead to also get linked memories and trigger auto-promotion.',
    memory_get_by_id: 'Get a memory by its numeric ID. Returns metadata only, does not affect tier.',
    memory_list:
        'List memories in a space, optionally filtered by tier or tag. Returns summaries with IDs (useful for linking). Does not include T4 frozen memories — use search for those.',
    memory_update: 'Update a memory name or content by ID. Use memory_patch instead if you also need to change tags, links, or tier in one atomic operation.',
    memory_delete: 'Delete a memory permanently by space and name. Also removes all links to/from this memory.',
    memory_read:
        'Read a memory and its linked context. Returns content, auto-promotes the tier (T4→T3→T2→T1), and includes linked memory summaries (links_to + linked_by). Prefer this over memory_get when you need full context.',
    memory_tag_add: 'Add a tag to a memory by ID. Use consistent tag conventions: cat:decision, cat:bugfix, cat:discovery, cat:pattern, cat:preference.',
    memory_tag_remove: 'Remove a tag from a memory by ID.',
    memory_tags_list: 'List all tags in the system. Check this before creating new tags to avoid duplicates.',
    memory_query:
        'Query memories across spaces with filters (space, tag, tier, date range) and pagination. Returns summaries with IDs. Does not include T4 frozen memories — use search for those.',
    memory_patch:
        'Atomically update a memory in one call: rename, edit content, change tier, add/remove tags, and add/remove links — all-or-nothing. Prefer this over separate calls when making multiple changes to the same memory.',
};

export function createMemoryTools(store: MindStore) {
    return {
        memory_add: {
            schema: MemoryAddSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_add,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
            handler: async (args: unknown) => {
                let parsed: z.infer<typeof MemoryAddSchema>;

                try {
                    parsed = MemoryAddSchema.parse(args);
                } catch (e: any) {
                    throw new Error(
                        `Invalid arguments: ${e.message}. Provide: space, name, content, tags (optional), tier (optional), pinned (optional), links_to_ids (optional).`
                    );
                }

                const memory = await store.addMemory(parsed.space, parsed.name, parsed.content, {
                    tags: parsed.tags,
                    tier: parsed.tier as Tier | undefined,
                    pinned: parsed.pinned,
                    linksToIds: parsed.links_to_ids,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Memory "${parsed.name}" added to space "${parsed.space}" (T${memory.tier}).`,
                        },
                    ],
                    memory,
                };
            },
        },
        memory_get: {
            schema: MemoryGetSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_get,
            annotations: { readOnlyHint: true },
            handler: async (args: unknown) => {
                const parsed = MemoryGetSchema.parse(args ?? {});
                if (!parsed.space || !parsed.name) {
                    throw new Error('Both space and memory name are required.');
                }
                const memory = store.getMemory(parsed.space, parsed.name);
                if (!memory) {
                    throw new Error(`Memory "${parsed.name}" not found in space "${parsed.space}".`);
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
            annotations: { readOnlyHint: true },
            handler: async (args: unknown) => {
                const parsed = MemoryGetByIdSchema.parse(args ?? {});
                if (!parsed.id) {
                    throw new Error('Memory ID is required.');
                }
                const memory = store.getMemoryById(parsed.id);
                if (!memory) {
                    throw new Error(`Memory with ID ${parsed.id} not found.`);
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
            annotations: { readOnlyHint: true },
            handler: async (args: unknown) => {
                const parsed = MemoryListSchema.parse(args ?? {});
                if (!parsed.space) {
                    throw new Error('Space is required.');
                }
                const memories = store.listMemories(parsed.space, {
                    tier: parsed.tier as Tier | undefined,
                    tag: parsed.tag,
                });
                return {
                    content: [
                        { type: 'text', text: `Found ${memories.length} memory/memories in space "${parsed.space}".` },
                    ],
                    memories,
                };
            },
        },
        memory_update: {
            schema: MemoryUpdateSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_update,
            annotations: { readOnlyHint: false, destructiveHint: false },
            handler: async (args: unknown) => {
                const parsed = MemoryUpdateSchema.parse(args ?? {});
                if (!parsed.id) {
                    throw new Error('Memory ID is required.');
                }
                await store.updateMemory(parsed.id, { name: parsed.name, content: parsed.content });
                const memory = store.getMemoryById(parsed.id);
                return {
                    content: [{ type: 'text', text: `Memory updated successfully.` }],
                    memory,
                };
            },
        },
        memory_delete: {
            schema: MemoryDeleteSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_delete,
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
            handler: async (args: unknown) => {
                const parsed = MemoryDeleteSchema.parse(args ?? {});
                if (!parsed.space || !parsed.name) {
                    throw new Error('Both space and memory name are required.');
                }
                store.deleteMemoryByName(parsed.space, parsed.name);
                return {
                    content: [{ type: 'text', text: `Memory "${parsed.name}" deleted from space "${parsed.space}".` }],
                };
            },
        },
        memory_read: {
            schema: MemoryReadSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_read,
            annotations: { readOnlyHint: false },
            handler: async (args: unknown) => {
                const parsed = MemoryReadSchema.parse(args ?? {});
                if (!parsed.space || !parsed.name) {
                    throw new Error('Both space and memory name are required.');
                }
                const memory = store.getMemory(parsed.space, parsed.name);
                if (!memory) {
                    throw new Error(`Memory "${parsed.name}" not found in space "${parsed.space}".`);
                }
                store.recordAccess(memory.id);
                const updatedMemory = store.getMemoryById(memory.id);
                const linkedSummaries = store.getLinkedMemorySummaries(memory.id);
                return {
                    content: [{ type: 'text', text: `Memory "${parsed.name}" read. Auto-promoted if applicable.` }],
                    memory: updatedMemory,
                    links_to: linkedSummaries.links_to,
                    linked_by: linkedSummaries.linked_by,
                };
            },
        },
        memory_tag_add: {
            schema: MemoryTagAddSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_tag_add,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            handler: async (args: unknown) => {
                const parsed = MemoryTagAddSchema.parse(args ?? {});
                if (!parsed.memoryId || !parsed.tag) {
                    throw new Error('Both memoryId and tag are required.');
                }
                store.addMemoryTag(parsed.memoryId, parsed.tag);
                const memory = store.getMemoryById(parsed.memoryId);
                return {
                    content: [{ type: 'text', text: `Tag "${parsed.tag}" added to memory.` }],
                    memory,
                };
            },
        },
        memory_tag_remove: {
            schema: MemoryTagRemoveSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_tag_remove,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            handler: async (args: unknown) => {
                const parsed = MemoryTagRemoveSchema.parse(args ?? {});
                if (!parsed.memoryId || !parsed.tag) {
                    throw new Error('Both memoryId and tag are required.');
                }
                store.removeMemoryTag(parsed.memoryId, parsed.tag);
                const memory = store.getMemoryById(parsed.memoryId);
                return {
                    content: [{ type: 'text', text: `Tag "${parsed.tag}" removed from memory.` }],
                    memory,
                };
            },
        },
        memory_tags_list: {
            schema: MemoryTagsListSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_tags_list,
            annotations: { readOnlyHint: true },
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
            annotations: { readOnlyHint: true },
            handler: async (args: unknown) => {
                const parsed = MemoryQuerySchema.parse(args ?? {});
                const limit = parsed.limit ?? 25;
                const offset = parsed.offset ?? 0;
                const memories = store.queryMemories({
                    space: parsed.space,
                    tag: parsed.tag,
                    tier: parsed.tier as Tier | undefined,
                    from: parsed.from,
                    to: parsed.to,
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
                    pagination: { limit, offset, nextOffset },
                };
            },
        },
        memory_patch: {
            schema: MemoryPatchSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_patch,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
            handler: async (args: unknown) => {
                const parsed = MemoryPatchSchema.parse(args ?? {});

                const hasAnyOperation =
                    parsed.name !== undefined ||
                    parsed.content !== undefined ||
                    parsed.pinned !== undefined ||
                    parsed.tier_transition !== undefined ||
                    (parsed.add_tags?.length ?? 0) > 0 ||
                    (parsed.remove_tags?.length ?? 0) > 0 ||
                    (parsed.add_links_to_ids?.length ?? 0) > 0 ||
                    (parsed.remove_links_to_ids?.length ?? 0) > 0;

                if (!hasAnyOperation) {
                    throw new Error(
                        'Provide at least one operation: name, content, pinned, tier_transition, add_tags, remove_tags, add_links_to_ids, or remove_links_to_ids.'
                    );
                }

                const memory = await store.patchMemory(parsed.id, {
                    name: parsed.name,
                    content: parsed.content,
                    pinned: parsed.pinned,
                    tierTransition: parsed.tier_transition,
                    addTags: parsed.add_tags,
                    removeTags: parsed.remove_tags,
                    addLinksToIds: parsed.add_links_to_ids,
                    removeLinksToIds: parsed.remove_links_to_ids,
                });

                return {
                    content: [{ type: 'text', text: `Memory ${parsed.id} patched successfully (atomic all-or-nothing).` }],
                    memory,
                };
            },
        },
    };
}
