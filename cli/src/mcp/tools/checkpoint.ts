import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

const CheckpointSetSchema = z.object({
    space: z.string().min(1).describe('Working space name.'),
    goal: z.string().optional().describe('Current goal or task.'),
    pending: z.string().optional().describe('What remains to be done.'),
    notes: z.string().optional().describe('Additional context or notes.'),
    relatedMemoryIds: z.array(z.number()).optional().describe('Memory IDs to link to this checkpoint.'),
});

const CheckpointCompleteSchema = z.object({
    space: z.string().describe('Working space name.'),
    checkpointId: z.number().describe('ID of the checkpoint to mark complete.'),
    whatWasDone: z.string().optional().describe('Summary of what was accomplished.'),
});

const CheckpointRecoverSchema = z.object({
    space: z.string().describe('Working space name to recover checkpoint from.'),
    includeHistory: z.boolean().optional().describe('Include completed checkpoints in results.'),
});

const CheckpointListSchema = z.object({
    space: z.string().describe('Working space name to list checkpoints from.'),
    status: z.enum(['active', 'completed', 'all']).optional().describe('Filter by status: active, completed, all.'),
});

const CHECKPOINT_TOOL_DESCRIPTIONS: Record<string, string> = {
    checkpoint_set: 'Create or update a checkpoint for the current work session.',
    checkpoint_complete: 'Mark a checkpoint as completed with a summary.',
    checkpoint_recover: 'Recover the most recent active checkpoint.',
    checkpoint_list: 'List all checkpoints for a space.',
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
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
            handler: async (args: unknown) => {
                const parsed = CheckpointSetSchema.parse(args ?? {});

                if (!parsed.space) {
                    throw new Error('Space is required.');
                }

                const checkpointSpace = getCheckpointSpaceName(parsed.space);

                const existingSpace = store.getSpace(checkpointSpace);
                if (!existingSpace) {
                    store.createSpace(checkpointSpace, `Checkpoints for ${parsed.space}`, ['checkpoint', 'system']);
                    store.updateSpace(checkpointSpace, { hidden: true });
                }

                const content = JSON.stringify(
                    {
                        goal: parsed.goal ?? '',
                        pending: parsed.pending ?? '',
                        notes: parsed.notes ?? '',
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
                        existingContent.goal = parsed.goal ?? '';
                        existingContent.pending = parsed.pending ?? '';
                        existingContent.notes = parsed.notes ?? '';
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

                if (parsed.relatedMemoryIds && parsed.relatedMemoryIds.length > 0 && checkpoint) {
                    for (const memoryId of parsed.relatedMemoryIds) {
                        try {
                            store.link(checkpoint.id, memoryId, 'related');
                        } catch {
                            // Ignore link errors
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
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            handler: async (args: unknown) => {
                const parsed = CheckpointCompleteSchema.parse(args ?? {});

                if (!parsed.space) {
                    throw new Error('Space is required.');
                }
                if (!parsed.checkpointId) {
                    throw new Error('Checkpoint ID is required.');
                }

                const checkpointSpace = getCheckpointSpaceName(parsed.space);
                const memory = store.getMemoryById(parsed.checkpointId);

                if (!memory) {
                    throw new Error(`Checkpoint with id ${parsed.checkpointId} not found.`);
                }

                if (memory.space_name !== checkpointSpace) {
                    throw new Error(`Checkpoint ${parsed.checkpointId} does not belong to space "${checkpointSpace}".`);
                }

                const existingContent = JSON.parse(memory.content);
                existingContent.whatWasDone = parsed.whatWasDone ?? '';
                existingContent.completedAt = now();
                existingContent.updatedAt = now();

                await store.updateMemory(parsed.checkpointId, {
                    content: JSON.stringify(existingContent, null, 2),
                });

                store.removeMemoryTag(parsed.checkpointId, 'active');
                store.addMemoryTag(parsed.checkpointId, 'completed');

                try {
                    store.demote(parsed.checkpointId);
                } catch {
                    // Ignore demotion errors
                }

                const updatedMemory = store.getMemoryById(parsed.checkpointId);

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
            annotations: { readOnlyHint: true },
            handler: async (args: unknown) => {
                const parsed = CheckpointRecoverSchema.parse(args ?? {});

                if (!parsed.space) {
                    throw new Error('Space is required.');
                }

                const checkpointSpace = getCheckpointSpaceName(parsed.space);

                const space = store.getSpace(checkpointSpace);
                if (!space) {
                    return {
                        content: [{ type: 'text', text: `No checkpoint space found for "${parsed.space}".` }],
                        checkpoint: null,
                    };
                }

                const allCheckpoints = store.listMemories(checkpointSpace, { tag: 'checkpoint' });

                let activeCheckpoints = allCheckpoints.filter((m) => m.tags.includes('active'));

                if (parsed.includeHistory) {
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
            annotations: { readOnlyHint: true },
            handler: async (args: unknown) => {
                const parsed = CheckpointListSchema.parse(args ?? {});

                if (!parsed.space) {
                    throw new Error('Space is required.');
                }

                const checkpointSpace = getCheckpointSpaceName(parsed.space);

                const space = store.getSpace(checkpointSpace);
                if (!space) {
                    return {
                        content: [{ type: 'text', text: `No checkpoint space found for "${parsed.space}".` }],
                        checkpoints: [],
                    };
                }

                let checkpoints = store.listMemories(checkpointSpace, { tag: 'checkpoint' });

                if (parsed.status && parsed.status !== 'all') {
                    checkpoints = checkpoints.filter((m) => m.tags.includes(parsed.status!));
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
