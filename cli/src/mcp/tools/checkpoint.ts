import { z } from 'zod';

import {
  buildRecoveryPack,
  renderRecoveryPack,
  type RecoveryFormat,
} from '../../checkpoint/recovery-pack';
import { isAgent, type Agent } from '../../cli/capabilities';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

import { resolveRefWithFallback } from './links';

const CheckpointSaveSchema = z.object({
  space: z.string().min(1).describe('Working space name.'),
  goal: z.string().optional().describe('Current goal or task.'),
  pending: z.string().optional().describe('What remains to be done.'),
  notes: z.string().optional().describe('Additional context or notes.'),
  relatedRefs: z
    .array(z.string())
    .optional()
    .describe(
      'Memory references relevant to current work (e.g. "my-memory" or "space:name"). Links these to the checkpoint so recovery includes full context.'
    ),
});

const CheckpointDoneSchema = z.object({
  space: z.string().describe('Working space name.'),
  checkpointName: z
    .string()
    .optional()
    .describe(
      'Name of the checkpoint to mark complete. If omitted, completes the active checkpoint.'
    ),
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
  status: z
    .enum(['active', 'completed', 'all'])
    .optional()
    .describe('Filter by status: active, completed, all.'),
});

const CHECKPOINT_TOOL_DESCRIPTIONS: Record<string, string> = {
  checkpoint_save:
    'Save or update the current work session state (goal, pending steps, notes). Creates a recoverable snapshot so work survives context resets or compaction. Keep this fresh as you make progress.',
  checkpoint_done:
    'Mark a checkpoint as done with a summary of what was accomplished. Demotes it to warm tier and frees the active slot for new work.',
  checkpoint_load:
    'Restore context from the most recent active checkpoint. Call this at session start or after context compaction to resume where you left off. Returns goal, pending steps, notes, and linked memories.',
  checkpoint_list:
    'List all checkpoints for a space, optionally filtered by status (active, completed, all). Use to find older sessions.',
};

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

        const space = parsed.space;

        // Verify the space exists
        if (!store.getSpace(space)) {
          throw new Error(`Space "${space}" not found.`);
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

        const existingCheckpoints = store.listMemories(space, { tag: 'checkpoint' });
        const activeCheckpoint = existingCheckpoints.find(m => m.tags.includes('active'));

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
          checkpoint = await store.addMemory(space, `checkpoint-${timestamp}`, content, {
            tags: ['checkpoint', 'active'],
            tier: 1 as Tier,
          });
        }

        if (parsed.relatedRefs && parsed.relatedRefs.length > 0 && checkpoint) {
          for (const ref of parsed.relatedRefs) {
            try {
              const resolved = resolveRefWithFallback(store, ref, space);
              store.link(checkpoint.id, resolved.id, 'related');
            } catch {
              // Ignore link errors
            }
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: `Checkpoint ${activeCheckpoint ? 'updated' : 'created'} in "${space}".`,
            },
          ],
          checkpoint: checkpoint
            ? {
                space,
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

        const space = parsed.space;

        let memory;
        if (parsed.checkpointName) {
          memory = store.getMemory(space, parsed.checkpointName);
          if (!memory) {
            throw new Error(`Checkpoint "${parsed.checkpointName}" not found in "${space}".`);
          }
        } else {
          // Find active checkpoint
          const checkpoints = store.listMemories(space, { tag: 'checkpoint' });
          memory = checkpoints.find(m => m.tags.includes('active'));
          if (!memory) {
            throw new Error(`No active checkpoint found in "${space}".`);
          }
          // listMemories returns summaries, get full memory
          memory = store.getMemoryById(memory.id);
          if (!memory) {
            throw new Error(`Active checkpoint could not be loaded.`);
          }
        }

        const existingContent = JSON.parse(memory.content);
        existingContent.whatWasDone = parsed.summary ?? '';
        existingContent.completedAt = now();
        existingContent.updatedAt = now();

        await store.updateMemory(memory.id, {
          content: JSON.stringify(existingContent, null, 2),
        });

        store.removeMemoryTag(memory.id, 'active');
        store.addMemoryTag(memory.id, 'completed');

        try {
          store.demote(memory.id);
        } catch {
          // Ignore demotion errors
        }

        const updatedMemory = store.getMemoryById(memory.id);

        return {
          content: [
            {
              type: 'text',
              text: `Checkpoint marked as completed and demoted to warm tier.`,
            },
          ],
          checkpoint: updatedMemory
            ? {
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
              space: recoveryPack.checkpoint.space,
              name: recoveryPack.checkpoint.name,
              tier: 1 as Tier,
              tags: recoveryPack.checkpoint.tags,
              content: recoveryPack.checkpoint.content,
              links: recoveryPack.checkpoint.links.map(link => ({
                targetRef: `${link.targetSpace}:${link.targetName}`,
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

        const space = parsed.space;

        if (!store.getSpace(space)) {
          return {
            content: [{ type: 'text', text: `Space "${space}" not found.` }],
            checkpoints: [],
          };
        }

        // Use queryMemories to include ALL tiers (completed checkpoints are demoted)
        let checkpoints = store.queryMemories({
          space,
          tag: 'checkpoint',
          limit: 500,
        });

        if (parsed.status && parsed.status !== 'all') {
          checkpoints = checkpoints.filter(m => m.tags.includes(parsed.status!));
        }

        checkpoints.sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );

        return {
          content: [
            {
              type: 'text',
              text: `Found ${checkpoints.length} checkpoint(s).`,
            },
          ],
          checkpoints: checkpoints.map(m => ({
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
