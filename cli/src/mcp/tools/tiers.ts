import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';

const MemoryPromoteSchema = z.object({
    id: z
        .number()
        .describe(
            '**Required.** Memory ID to promote. Get ID from memory_list, memory_query, or search. Promotion moves memory one tier up: T4→T3, T3→T2, T2→T1. Cannot promote if already at T1.'
        ),
});

const MemoryDemoteSchema = z.object({
    id: z
        .number()
        .describe(
            '**Required.** Memory ID to demote. Get ID from memory_list, memory_query, or search. Demotion moves memory one tier down: T1→T2, T2→T3, T3→T4. Cannot demote if already at T4 (frozen).'
        ),
});

const MemoryPinSchema = z.object({
    id: z
        .number()
        .describe(
            '**Required.** Memory ID to pin. Get ID from memory_list, memory_query, or search. Pinned memories: 1) Do NOT auto-promote on read, 2) Are immune to LRU eviction. Use for critical memories.'
        ),
});

const MemoryUnpinSchema = z.object({
    id: z
        .number()
        .describe(
            '**Required.** Memory ID to unpin. Get ID from memory_list, memory_query, or search. Unpinned memories resume normal tier behavior: auto-promote on read, eligible for LRU eviction.'
        ),
});

const TIER_TOOL_DESCRIPTIONS: Record<string, string> = {
    memory_promote: 'Promote a memory one tier up (T4→T3→T2→T1).',
    memory_demote: 'Demote a memory one tier down (T1→T2→T3→T4).',
    memory_pin: 'Pin a memory to prevent auto-promotion and LRU eviction.',
    memory_unpin: 'Unpin a memory to restore normal tier behavior.',
};

export function createTierTools(store: MindStore) {
    return {
        memory_promote: {
            schema: MemoryPromoteSchema,
            description: TIER_TOOL_DESCRIPTIONS.memory_promote,
            handler: async (args: z.infer<typeof MemoryPromoteSchema>) => {
                const memoryBefore = store.getMemoryById(args.id);
                if (!memoryBefore) {
                    throw new Error(`Memory with ID ${args.id} not found.`);
                }
                if (memoryBefore.tier === 1) {
                    throw new Error('Cannot promote: memory is already at T1 (hot).');
                }

                store.promote(args.id);
                const memory = store.getMemoryById(args.id);
                if (!memory) {
                    throw new Error(`Memory with ID ${args.id} not found after promotion.`);
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
            handler: async (args: z.infer<typeof MemoryDemoteSchema>) => {
                const memoryBefore = store.getMemoryById(args.id);
                if (!memoryBefore) {
                    throw new Error(`Memory with ID ${args.id} not found.`);
                }
                if (memoryBefore.tier === 4) {
                    throw new Error('Cannot demote: memory is already at T4 (frozen).');
                }

                store.demote(args.id);
                const memory = store.getMemoryById(args.id);
                if (!memory) {
                    throw new Error(`Memory with ID ${args.id} not found after demotion.`);
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
            handler: async (args: z.infer<typeof MemoryPinSchema>) => {
                store.pin(args.id);
                const memory = store.getMemoryById(args.id);
                if (!memory) {
                    throw new Error(`Memory with ID ${args.id} not found.`);
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
            handler: async (args: z.infer<typeof MemoryUnpinSchema>) => {
                store.unpin(args.id);
                const memory = store.getMemoryById(args.id);
                if (!memory) {
                    throw new Error(`Memory with ID ${args.id} not found.`);
                }
                return {
                    content: [{ type: 'text', text: `Memory "${memory.name}" unpinned.` }],
                    memory,
                };
            },
        },
    };
}
