import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

const CheckpointSetSchema = z.object({
    space: z
        .string()
        .describe(
            '**Required.** Working space name (NOT the checkpoint space — the space you are working in). Example: "projects/mind" or "my-project". This creates a hidden space: "my-project:sessions".'
        ),
    goal: z
        .string()
        .describe(
            '**Required.** Current goal or task. What are you actively working on? This displays to recovered sessions.'
        ),
    pending: z
        .string()
        .describe(
            '**Required.** What remains to be done. Remaining tasks, unfinished work. This helps recover session context.'
        ),
    notes: z
        .string()
        .optional()
        .describe('Optional. Additional context, links, or notes. Not displayed in recovery by default.'),
    relatedMemoryIds: z
        .array(z.number())
        .optional()
        .describe(
            'Optional. Memory IDs to link to this checkpoint. Useful for tracking related decisions, bugs, or context memories. Get IDs from memory_list/query/search.'
        ),
});

const CheckpointCompleteSchema = z.object({
    space: z
        .string()
        .describe(
            '**Required.** Working space name (same as used in checkpoint_set). This identifies which checkpoint space to use.'
        ),
    checkpointId: z
        .number()
        .describe(
            '**Required.** ID of the checkpoint to mark complete. Get ID from checkpoint_list or checkpoint_recover. This moves the checkpoint from active to completed.'
        ),
    whatWasDone: z
        .string()
        .describe(
            '**Required.** Summary of what was accomplished. This is recorded in the checkpoint history and helps track progress over time.'
        ),
});

const CheckpointRecoverSchema = z.object({
    space: z
        .string()
        .describe(
            '**Required.** Working space name to recover checkpoint from. Looks for hidden space: "space-name:sessions".'
        ),
    includeHistory: z
        .boolean()
        .optional()
        .describe(
            'Optional. Include completed (historical) checkpoints in results. Default: false — only returns active checkpoint. Set true to see full history.'
        ),
});

const CheckpointListSchema = z.object({
    space: z
        .string()
        .describe(
            '**Required.** Working space name to list checkpoints from. Looks in hidden space: "space-name:sessions".'
        ),
    status: z
        .enum(['active', 'completed', 'all'])
        .optional()
        .describe(
            'Optional. Filter by checkpoint status: "active" (default, in-progress), "completed" (done), "all" (both). Default: "active".'
        ),
});

const CHECKPOINT_TOOL_DESCRIPTIONS: Record<string, string> = {
    checkpoint_set: 'Create or update a checkpoint for the current work session (goal + pending).',
    checkpoint_complete: 'Mark a checkpoint as completed with a summary of what was done.',
    checkpoint_recover: 'Recover the most recent active checkpoint to resume work.',
    checkpoint_list: 'List all checkpoints for a space (active, completed, or all).',
};

function getCheckpointSpaceName(space: string): string {
    return `${space}:sessions`;
}

function now(): string {
    return new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
}

export function createCheckpointTools(store: MindStore) {
    return {
        checkpoint_set: {
            schema: CheckpointSetSchema,
            description: CHECKPOINT_TOOL_DESCRIPTIONS.checkpoint_set,
            handler: async (args: z.infer<typeof CheckpointSetSchema>) => {
                const checkpointSpace = getCheckpointSpaceName(args.space);

                const existingSpace = store.getSpace(checkpointSpace);
                if (!existingSpace) {
                    store.createSpace(checkpointSpace, `Checkpoints for ${args.space}`, ['checkpoint', 'system']);
                    store.updateSpace(checkpointSpace, { hidden: true });
                }

                const content = JSON.stringify(
                    {
                        goal: args.goal,
                        pending: args.pending,
                        notes: args.notes || '',
                        createdAt: now(),
                        updatedAt: now(),
                    },
                    null,
                    2
                );

                const existingCheckpoints = store.listMemories(checkpointSpace, { tag: 'checkpoint' });
                const activeCheckpoint = existingCheckpoints.find((m) => m.tags.includes('active'));

                let checkpoint;
                if (activeCheckpoint) {
                    const memory = store.getMemoryById(activeCheckpoint.id);
                    if (memory) {
                        const existingContent = JSON.parse(memory.content);
                        existingContent.goal = args.goal;
                        existingContent.pending = args.pending;
                        existingContent.notes = args.notes || '';
                        existingContent.updatedAt = now();

                        await store.updateMemory(activeCheckpoint.id, {
                            content: JSON.stringify(existingContent, null, 2),
                        });
                        checkpoint = store.getMemoryById(activeCheckpoint.id);
                    }
                } else {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    checkpoint = await store.addMemory(checkpointSpace, `checkpoint-${timestamp}`, content, {
                        tags: ['checkpoint', 'active'],
                        tier: 1 as Tier,
                    });
                }

                if (args.relatedMemoryIds && args.relatedMemoryIds.length > 0 && checkpoint) {
                    for (const memoryId of args.relatedMemoryIds) {
                        try {
                            store.link(checkpoint.id, memoryId, 'related');
                        } catch {
                            // Link might already exist or memory might not exist, ignore
                        }
                    }
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Checkpoint ${activeCheckpoint ? 'updated' : 'created'} in "${checkpointSpace}".`,
                        },
                    ],
                    checkpoint: checkpoint
                        ? {
                              id: checkpoint.id,
                              space: checkpointSpace,
                              name: checkpoint.name,
                              tier: checkpoint.tier,
                              tags: checkpoint.tags,
                          }
                        : undefined,
                };
            },
        },

        checkpoint_complete: {
            schema: CheckpointCompleteSchema,
            description: CHECKPOINT_TOOL_DESCRIPTIONS.checkpoint_complete,
            handler: async (args: z.infer<typeof CheckpointCompleteSchema>) => {
                const checkpointSpace = getCheckpointSpaceName(args.space);
                const memory = store.getMemoryById(args.checkpointId);

                if (!memory) {
                    throw new Error(`Checkpoint with id ${args.checkpointId} not found.`);
                }

                if (memory.space_name !== checkpointSpace) {
                    throw new Error(`Checkpoint ${args.checkpointId} does not belong to space "${checkpointSpace}".`);
                }

                const existingContent = JSON.parse(memory.content);
                existingContent.whatWasDone = args.whatWasDone;
                existingContent.completedAt = now();
                existingContent.updatedAt = now();

                await store.updateMemory(args.checkpointId, {
                    content: JSON.stringify(existingContent, null, 2),
                });

                store.removeMemoryTag(args.checkpointId, 'active');
                store.addMemoryTag(args.checkpointId, 'completed');

                try {
                    store.demote(args.checkpointId);
                } catch {
                    // Might be at T1 already or at max capacity, ignore
                }

                const updatedMemory = store.getMemoryById(args.checkpointId);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Checkpoint marked as completed and demoted to warm tier.`,
                        },
                    ],
                    checkpoint: updatedMemory
                        ? {
                              id: updatedMemory.id,
                              space: updatedMemory.space_name,
                              name: updatedMemory.name,
                              tier: updatedMemory.tier,
                              tags: updatedMemory.tags,
                          }
                        : undefined,
                };
            },
        },

        checkpoint_recover: {
            schema: CheckpointRecoverSchema,
            description: CHECKPOINT_TOOL_DESCRIPTIONS.checkpoint_recover,
            handler: async (args: z.infer<typeof CheckpointRecoverSchema>) => {
                const checkpointSpace = getCheckpointSpaceName(args.space);

                const space = store.getSpace(checkpointSpace);
                if (!space) {
                    return {
                        content: [{ type: 'text', text: `No checkpoint space found for "${args.space}".` }],
                        checkpoint: null,
                    };
                }

                const allCheckpoints = store.listMemories(checkpointSpace, { tag: 'checkpoint' });

                let activeCheckpoints = allCheckpoints.filter((m) => m.tags.includes('active'));

                if (args.includeHistory) {
                    const completedCheckpoints = allCheckpoints.filter((m) => m.tags.includes('completed'));
                    activeCheckpoints = [...activeCheckpoints, ...completedCheckpoints];
                }

                activeCheckpoints.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

                if (activeCheckpoints.length === 0) {
                    return {
                        content: [{ type: 'text', text: `No active checkpoints found.` }],
                        checkpoint: null,
                    };
                }

                const latest = activeCheckpoints[0]!;
                const fullMemory = store.getMemoryById(latest.id);

                if (!fullMemory) {
                    return {
                        content: [{ type: 'text', text: `Checkpoint memory not found.` }],
                        checkpoint: null,
                    };
                }

                const links = store.getLinks(latest.id);

                let content;
                try {
                    content = JSON.parse(fullMemory.content);
                } catch {
                    content = { raw: fullMemory.content };
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Found active checkpoint: "${latest.name}".`,
                        },
                    ],
                    checkpoint: {
                        id: fullMemory.id,
                        space: fullMemory.space_name,
                        name: fullMemory.name,
                        tier: fullMemory.tier,
                        tags: fullMemory.tags,
                        content,
                        links: links.map((l) => ({
                            targetId: l.target_id,
                            targetName: l.target_name,
                            targetSpace: l.target_space,
                            label: l.label,
                        })),
                    },
                    note: 'Use checkpoint_list to see other checkpoints if needed.',
                };
            },
        },

        checkpoint_list: {
            schema: CheckpointListSchema,
            description: CHECKPOINT_TOOL_DESCRIPTIONS.checkpoint_list,
            handler: async (args: z.infer<typeof CheckpointListSchema>) => {
                const checkpointSpace = getCheckpointSpaceName(args.space);

                const space = store.getSpace(checkpointSpace);
                if (!space) {
                    return {
                        content: [{ type: 'text', text: `No checkpoint space found for "${args.space}".` }],
                        checkpoints: [],
                    };
                }

                let checkpoints = store.listMemories(checkpointSpace, { tag: 'checkpoint' });

                if (args.status && args.status !== 'all') {
                    checkpoints = checkpoints.filter((m) => m.tags.includes(args.status!));
                }

                checkpoints.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Found ${checkpoints.length} checkpoint(s).`,
                        },
                    ],
                    checkpoints: checkpoints.map((m) => ({
                        id: m.id,
                        name: m.name,
                        tier: m.tier,
                        tags: m.tags,
                        updatedAt: m.updated_at,
                    })),
                };
            },
        },
    };
}
