import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';

const MemoryPromoteSchema = z.object({
    id: z.number().describe('Memory ID to promote. Moves one tier up: T4→T3→T2→T1.'),
});

const MemoryDemoteSchema = z.object({
    id: z.number().describe('Memory ID to demote. Moves one tier down: T1→T2→T3→T4.'),
});

const MemoryPinSchema = z.object({
    id: z.number().describe('Memory ID to pin. Prevents auto-promotion and LRU eviction.'),
});

const MemoryUnpinSchema = z.object({
    id: z.number().describe('Memory ID to unpin. Restores normal tier behavior.'),
});

const TIER_TOOL_DESCRIPTIONS: Record<string, string> = {
    memory_promote:
        'Promote a memory one tier up (T4→T3→T2→T1). Use when a memory becomes more relevant than its current tier suggests. Note: memory_read auto-promotes on access.',
    memory_demote:
        'Demote a memory one tier down (T1→T2→T3→T4). Use to archive outdated context or free space in higher tiers. T4 memories are only findable via search.',
    memory_pin:
        'Pin a memory to freeze it at its current tier. Pinned memories are immune to auto-promotion (from memory_read) and LRU eviction. Use for stable reference info that should not move.',
    memory_unpin: 'Unpin a memory to restore normal tier behavior (auto-promotion on read, LRU eviction when tier is full).',
};

export function createTierTools(store: MindStore) {
    return {
        memory_promote: {
            schema: MemoryPromoteSchema,
            description: TIER_TOOL_DESCRIPTIONS.memory_promote,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            handler: async (args: unknown) => {
                const parsed = MemoryPromoteSchema.parse(args ?? {});
                if (!parsed.id) {
                    throw new Error('Memory ID is required.');
                }
                const memoryBefore = store.getMemoryById(parsed.id);
                if (!memoryBefore) {
                    throw new Error(`Memory with ID ${parsed.id} not found.`);
                }
                if (memoryBefore.tier === 1) {
                    throw new Error('Cannot promote: memory is already at T1 (hot).');
                }

                store.promote(parsed.id);
                const memory = store.getMemoryById(parsed.id);
                if (!memory) {
                    throw new Error(`Memory with ID ${parsed.id} not found after promotion.`);
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Memory "${memory.name}" promoted from T${memoryBefore.tier} to T${memory.tier}.`,
                        },
                    ],
                    memory,
                };
            },
        },
        memory_demote: {
            schema: MemoryDemoteSchema,
            description: TIER_TOOL_DESCRIPTIONS.memory_demote,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            handler: async (args: unknown) => {
                const parsed = MemoryDemoteSchema.parse(args ?? {});
                if (!parsed.id) {
                    throw new Error('Memory ID is required.');
                }
                const memoryBefore = store.getMemoryById(parsed.id);
                if (!memoryBefore) {
                    throw new Error(`Memory with ID ${parsed.id} not found.`);
                }
                if (memoryBefore.tier === 4) {
                    throw new Error('Cannot demote: memory is already at T4 (frozen).');
                }

                store.demote(parsed.id);
                const memory = store.getMemoryById(parsed.id);
                if (!memory) {
                    throw new Error(`Memory with ID ${parsed.id} not found after demotion.`);
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Memory "${memory.name}" demoted from T${memoryBefore.tier} to T${memory.tier}.`,
                        },
                    ],
                    memory,
                };
            },
        },
        memory_pin: {
            schema: MemoryPinSchema,
            description: TIER_TOOL_DESCRIPTIONS.memory_pin,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            handler: async (args: unknown) => {
                const parsed = MemoryPinSchema.parse(args ?? {});
                if (!parsed.id) {
                    throw new Error('Memory ID is required.');
                }
                store.pin(parsed.id);
                const memory = store.getMemoryById(parsed.id);
                if (!memory) {
                    throw new Error(`Memory with ID ${parsed.id} not found.`);
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Memory "${memory.name}" pinned. It will not be auto-promoted or evicted.`,
                        },
                    ],
                    memory,
                };
            },
        },
        memory_unpin: {
            schema: MemoryUnpinSchema,
            description: TIER_TOOL_DESCRIPTIONS.memory_unpin,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            handler: async (args: unknown) => {
                const parsed = MemoryUnpinSchema.parse(args ?? {});
                if (!parsed.id) {
                    throw new Error('Memory ID is required.');
                }
                store.unpin(parsed.id);
                const memory = store.getMemoryById(parsed.id);
                if (!memory) {
                    throw new Error(`Memory with ID ${parsed.id} not found.`);
                }
                return {
                    content: [{ type: 'text', text: `Memory "${memory.name}" unpinned.` }],
                    memory,
                };
            },
        },
    };
}
