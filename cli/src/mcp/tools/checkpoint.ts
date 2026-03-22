import { z } from 'zod';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';
import { buildRecoveryPack, renderRecoveryPack, type RecoveryFormat } from '../../checkpoint/recovery-pack';
import { isAgent, type Agent } from '../../cli/capabilities';

const CheckpointSaveSchema = z.object({
    space: z.string().min(1).describe('Working space name.'),
    goal: z.string().optional().describe('Current goal or task.'),
    pending: z.string().optional().describe('What remains to be done.'),
    notes: z.string().optional().describe('Additional context or notes.'),
    relatedRefs: z
        .array(z.number())
        .optional()
        .describe('Memory IDs relevant to current work. Links these to the checkpoint so recovery includes full context. Get IDs from memory_query or search.'),
});

const CheckpointDoneSchema = z.object({
    space: z.string().describe('Working space name.'),
    checkpointId: z.number().describe('ID of the checkpoint to mark complete.'),
    summary: z.string().optional().describe('Summary of what was accomplished.'),
});

const CheckpointLoadSchema = z.object({
    space: z.string().describe('Working space name to recover checkpoint from.'),
    includeHistory: z.boolean().optional().describe('Include completed checkpoints in results.'),
    format: z.enum(['text', 'md', 'json']).optional().describe('Output format for recovery pack.'),
    agent: z.string().optional().describe('Agent profile to evaluate capability fallback against.'),
});

const CheckpointListSchema = z.object({
    space: z.string().describe('Working space name to list checkpoints from.'),
    status: z.enum(['active', 'completed', 'all']).optional().describe('Filter by status: active, completed, all.'),
});

const CHECKPOINT_TOOL_DESCRIPTIONS: Record<string, string> = {
    checkpoint_save:
        'Save or update the current work session state (goal, pending steps, notes). Creates a recoverable snapshot so work survives context resets or compaction. Keep this fresh as you make progress.',
    checkpoint_done:
        'Mark a checkpoint as done with a summary of what was accomplished. Demotes it to warm tier and frees the active slot for new work.',
    checkpoint_load:
        'Restore context from the most recent active checkpoint. Call this at session start or after context compaction to resume where you left off. Returns goal, pending steps, notes, and linked memories.',
    checkpoint_list: 'List all checkpoints for a space, optionally filtered by status (active, completed, all). Use to find older sessions.',
};

function getCheckpointSpaceName(space: string): string {
    return `${space}:sessions`;
}

function now(): string {
    return new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
}

export function createCheckpointTools(store: MindStore) {
    return {
        checkpoint_save: {
            schema: CheckpointSaveSchema,
            description: CHECKPOINT_TOOL_DESCRIPTIONS.checkpoint_save,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
            handler: async (args: unknown) => {
                const parsed = CheckpointSaveSchema.parse(args ?? {});

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

                if (parsed.relatedRefs && parsed.relatedRefs.length > 0 && checkpoint) {
                    for (const memoryId of parsed.relatedRefs) {
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

        checkpoint_done: {
            schema: CheckpointDoneSchema,
            description: CHECKPOINT_TOOL_DESCRIPTIONS.checkpoint_done,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            handler: async (args: unknown) => {
                const parsed = CheckpointDoneSchema.parse(args ?? {});

                if (!parsed.space) {
                    throw new Error('Space is required.');
                }
                if (parsed.checkpointId == null) {
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
                existingContent.whatWasDone = parsed.summary ?? '';
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

        checkpoint_load: {
            schema: CheckpointLoadSchema,
            description: CHECKPOINT_TOOL_DESCRIPTIONS.checkpoint_load,
            annotations: { readOnlyHint: true },
            handler: async (args: unknown) => {
                const parsed = CheckpointLoadSchema.parse(args ?? {});

                if (!parsed.space) {
                    throw new Error('Space is required.');
                }

                const requestedFormat = (parsed.format ?? 'text') as RecoveryFormat;
                const requestedAgent = parsed.agent ?? 'opencode';
                const resolvedAgent: Agent = isAgent(requestedAgent) ? requestedAgent : 'opencode';

                const recoveryPack = await buildRecoveryPack(store, {
                    space: parsed.space,
                    includeHistory: parsed.includeHistory,
                    agent: resolvedAgent,
                });

                const checkpoint = recoveryPack.checkpoint
                    ? {
                          id: recoveryPack.checkpoint.id,
                          space: recoveryPack.checkpoint.space,
                          name: recoveryPack.checkpoint.name,
                          tier: 1 as Tier,
                          tags: recoveryPack.checkpoint.tags,
                          content: recoveryPack.checkpoint.content,
                          links: recoveryPack.checkpoint.links.map((link) => ({
                              targetId: link.targetId,
                              targetName: link.targetName,
                              targetSpace: link.targetSpace,
                              label: link.label,
                          })),
                      }
                    : null;

                return {
                    content: [
                        {
                            type: 'text',
                            text: renderRecoveryPack(recoveryPack, requestedFormat),
                        },
                    ],
                    checkpoint,
                    recoveryPack,
                    note:
                        recoveryPack.checkpoint === null
                            ? 'No active checkpoint found; recovery guidance included.'
                            : 'Use checkpoint_list to see other checkpoints if needed.',
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
