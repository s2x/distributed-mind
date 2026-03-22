import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

// =============================================================================
// Schemas — Phase 2.2 Redesign
// =============================================================================

const MemoryAddSchema = z.object({
    space: z.string().min(1).describe('Space to add memory to. Must exist first.'),
    name: z.string().min(1).describe('Memory name/title.'),
    content: z.string().min(1).describe('Memory content.'),
    tags: z.array(z.string()).min(1).describe('Tags (at least 1 required).'),
    tier: z.number().int().min(1).max(3).optional().describe('Optional tier: 1=hot, 2=warm, 3=cold.'),
    pinned: z.boolean().optional().describe('Optional pinned state. true keeps memory immune to auto-promotion and LRU eviction.'),
    links_to_ids: z
        .array(z.number().int())
        .optional()
        .describe(
            'IDs of existing memories this one relates to. Creates directional links (new → target). Use when this memory depends on, extends, or is caused by another. Get IDs from memory_query or search.'
        ),
});

const MemoryReadSchema = z.object({
    space: z.string().min(1).describe('Space containing the memory.'),
    name: z.string().min(1).describe('Memory name to read.'),
    noPromote: z.boolean().optional().default(false).describe('If true, inspect the memory without side effects: no access count bump, no tier promotion. Use when browsing or checking content without intending to "use" the memory.'),
});

const MemoryUpdateSchema = z.object({
    id: z.number().describe('Memory ID to update.'),
    name: z.string().optional().describe('New memory name.'),
    content: z.string().optional().describe('New content.'),
    tags: z.array(z.string()).optional().describe('New tags array (replaces existing). Omit to keep existing tags.'),
});

const MemoryDeleteSchema = z.object({
    space: z.string().min(1).describe('Space containing the memory.'),
    name: z.string().min(1).describe('Memory name to delete.'),
});

const MEMORY_TOOL_DESCRIPTIONS: Record<string, string> = {
    memory_add:
        'Add a new memory to a space. Use immediately after important events: decisions, bug fixes, discoveries, config changes. Supports creating links to related memories via links_to_ids — always link when the new memory depends on or extends an existing one.',
    memory_update: 'Update a memory name, content, or tags by ID. If tags is provided, it replaces the entire existing tags array.',
    memory_delete: 'Delete a memory permanently by space and name. Also removes all links to/from this memory.',
    memory_read:
        'Read a memory with its content and linked context (links_to + linked_by). By default, records access and auto-promotes the tier (T4→T3→T2→T1) — use this when actively working with a memory. Pass noPromote:true to inspect without side effects (no access count bump, no tier change).',
};

// =============================================================================
// TierChange type (for memory.read tier_change response)
// =============================================================================

interface TierChange {
    from: Tier;
    to: Tier;
    reason: string;
}

// =============================================================================
// Tool Handlers
// =============================================================================

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
                    // Improve error message for tags
                    const msg = e.message || '';
                    if (parsed === undefined && msg.includes('tags')) {
                        throw new Error('tags is required and must be a non-empty array');
                    }
                    throw new Error(
                        `Invalid arguments: ${e.message}. Provide: space, name, content, tags (required, min 1), tier (optional), pinned (optional), links_to_ids (optional).`
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

        memory_update: {
            schema: MemoryUpdateSchema,
            description: MEMORY_TOOL_DESCRIPTIONS.memory_update,
            annotations: { readOnlyHint: false, destructiveHint: false },
            handler: async (args: unknown) => {
                const parsed = MemoryUpdateSchema.parse(args ?? {});
                if (!parsed.id) {
                    throw new Error('Memory ID is required.');
                }

                // Validate memory exists
                const existing = store.getMemoryById(parsed.id);
                if (!existing) {
                    throw new Error(`Memory with ID ${parsed.id} not found.`);
                }

                // Update name and/or content if provided
                if (parsed.name !== undefined || parsed.content !== undefined) {
                    await store.updateMemory(parsed.id, {
                        name: parsed.name,
                        content: parsed.content,
                    });
                }

                // Replace tags if provided (per task: tags replaces entire array)
                if (parsed.tags !== undefined) {
                    store.setMemoryTags(parsed.id, parsed.tags);
                }

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

                // noPromote: true means read without side effects (like the old memory_get)
                if (parsed.noPromote) {
                    // Get linked memory summaries
                    const linkedSummaries = store.getLinkedMemorySummaries(memory.id);

                    const links_to = linkedSummaries.links_to.map((l) => ({
                        id: l.id,
                        name: l.name,
                        space: l.space_name,
                        tier: l.tier,
                        tags: l.tags,
                        pinned: l.pinned,
                        changed_at: l.changed_at,
                    }));

                    const linked_by = linkedSummaries.linked_by.map((l) => ({
                        id: l.id,
                        name: l.name,
                        space: l.space_name,
                        tier: l.tier,
                        tags: l.tags,
                        pinned: l.pinned,
                        changed_at: l.changed_at,
                    }));

                    return {
                        content: [{ type: 'text', text: `Memory "${parsed.name}" read (no promotion).` }],
                        memory,
                        links_to,
                        linked_by,
                        tier_change: null,
                    };
                }

                // Capture tier BEFORE recordAccess for tier_change calculation
                const fromTier = memory.tier;
                const wasPinned = memory.pinned;

                // Record access (bumps count, updates last_accessed_at, auto-promotes if not pinned)
                store.recordAccess(memory.id);

                // Get updated memory after recordAccess
                const updatedMemory = store.getMemoryById(memory.id);
                const toTier = updatedMemory?.tier ?? fromTier;

                // Calculate tier_change
                let tier_change: TierChange;
                if (wasPinned) {
                    tier_change = {
                        from: fromTier,
                        to: fromTier,
                        reason: 'pinned - promotion skipped',
                    };
                } else if (fromTier === 1) {
                    tier_change = {
                        from: 1,
                        to: 1,
                        reason: 'already at T1',
                    };
                } else if (fromTier === toTier) {
                    // Tier didn't change (maybe destination was full and all pinned)
                    tier_change = {
                        from: fromTier,
                        to: toTier,
                        reason: 'destination full - promotion skipped',
                    };
                } else {
                    tier_change = {
                        from: fromTier,
                        to: toTier,
                        reason: 'auto-promote on read',
                    };
                }

                // Get linked memory summaries
                const linkedSummaries = store.getLinkedMemorySummaries(memory.id);

                const links_to = linkedSummaries.links_to.map((l) => ({
                    id: l.id,
                    name: l.name,
                    space: l.space_name,
                    tier: l.tier,
                    tags: l.tags,
                    pinned: l.pinned,
                    changed_at: l.changed_at,
                }));

                const linked_by = linkedSummaries.linked_by.map((l) => ({
                    id: l.id,
                    name: l.name,
                    space: l.space_name,
                    tier: l.tier,
                    tags: l.tags,
                    pinned: l.pinned,
                    changed_at: l.changed_at,
                }));

                return {
                    content: [{ type: 'text', text: `Memory "${parsed.name}" read. Auto-promoted if applicable.` }],
                    memory: updatedMemory,
                    links_to,
                    linked_by,
                    tier_change,
                };
            },
        },

    };
}

// =============================================================================
// Re-export types for convenience (used by MCP server)
// =============================================================================

export type { TierChange };
