import { z } from 'zod';

import { completeCheckpoint } from '../../checkpoint/checkpoint-done';
import type { MindStore } from '../../store/mind-store';
import type { Tier } from '../../types';

import { resolveRefWithFallback } from './links';

const CheckpointSaveSchema = z.object({
  space: z.string().min(1).describe('Working space name.'),
  goal: z.string().optional().describe('Current goal or task.'),
  pending: z.string().optional().describe('What remains to be done.'),
  notes: z.string().optional().describe('Additional context or notes.'),
  linked_memories: z
    .array(z.string())
    .optional()
    .describe(
      'Memory refs to link (e.g. "my-memory" or "space:name"). Linked memories are included in checkpoint recovery.'
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
  checkpointName: z
    .string()
    .describe(
      'Name of the specific checkpoint to load. Use checkpoint_query first to find available checkpoints.'
    ),
});

const CheckpointQuerySchema = z.object({
  space: z.string().describe('Working space name.'),
  status: z
    .enum(['active', 'completed', 'all'])
    .optional()
    .describe('Filter: active, completed, or all.'),
  from: z.string().optional().describe('Start date (YYYY-MM-DD).'),
  to: z.string().optional().describe('End date (YYYY-MM-DD).'),
  tag: z.string().optional().describe('Filter by tag.'),
  limit: z.number().optional().default(25).describe('Max results (default: 25).'),
  offset: z.number().optional().default(0).describe('Zero-based offset (default: 0).'),
});

const CHECKPOINT_TOOL_DESCRIPTIONS: Record<string, string> = {
  checkpoint_save:
    'Save or update a session checkpoint (goal, pending, notes, linked_memories). Creates a recoverable snapshot for context resets or compaction.',
  checkpoint_done:
    'Complete a checkpoint and transform it into a session memory in sessions/<repo>. The checkpoint is deleted and a session memory is created.',
  checkpoint_load:
    'Restore a specific checkpoint by name. Returns checkpoint state and linked_memories in enriched format.',
  checkpoint_query:
    'Find checkpoints by status, date range, or tag. Returns goal and pending preview with pagination.',
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

        if (parsed.linked_memories && parsed.linked_memories.length > 0 && checkpoint) {
          for (const ref of parsed.linked_memories) {
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

        let checkpointMemory;
        if (parsed.checkpointName) {
          checkpointMemory = store.getMemory(space, parsed.checkpointName);
          if (!checkpointMemory) {
            throw new Error(`Checkpoint "${parsed.checkpointName}" not found in "${space}".`);
          }
        } else {
          // Find active checkpoint
          const checkpoints = store.listMemories(space, { tag: 'checkpoint' });
          checkpointMemory = checkpoints.find(m => m.tags.includes('active'));
          if (!checkpointMemory) {
            throw new Error(`No active checkpoint found in "${space}".`);
          }
          // listMemories returns summaries, get full memory
          checkpointMemory = store.getMemoryById(checkpointMemory.id);
          if (!checkpointMemory) {
            throw new Error(`Active checkpoint could not be loaded.`);
          }
        }

        // Transform checkpoint into session memory (shared logic with CLI)
        const result = await completeCheckpoint(
          store,
          space,
          checkpointMemory.id,
          parsed.summary ?? ''
        );

        return {
          content: [
            {
              type: 'text',
              text: `Checkpoint transformed into session memory "${result.sessionMemory.name}" in "${result.sessionMemory.space}".`,
            },
          ],
          session_memory: result.sessionMemory,
        };
      },
    },

    checkpoint_load: {
      schema: CheckpointLoadSchema,
      description: CHECKPOINT_TOOL_DESCRIPTIONS.checkpoint_load,
      annotations: { readOnlyHint: true },
      handler: async (args: unknown) => {
        const parsed = CheckpointLoadSchema.safeParse(args ?? {});

        if (!parsed.success) {
          // Check if it's the checkpointName error
          const issues = parsed.error.issues;
          const checkpointNameIssue = issues.find(i => i.path.includes('checkpointName'));
          if (checkpointNameIssue) {
            throw new Error(
              'checkpointName is required. Use checkpoint_query first to find available checkpoints.'
            );
          }
          throw new Error(`Validation error: ${parsed.error.message}`);
        }

        const data = parsed.data;

        if (!data.space) {
          throw new Error('Space is required.');
        }

        // Find checkpoint by name
        let checkpointMemory = store.getMemory(data.space, data.checkpointName);
        if (!checkpointMemory) {
          throw new Error(`Checkpoint "${data.checkpointName}" not found in "${data.space}".`);
        }
        checkpointMemory = store.getMemoryById(checkpointMemory.id);

        // Build linked_memories in memory_read format (enriched)
        const linked_memories: Array<{
          name: string;
          space: string;
          ref: string;
          tier: number;
          tags: string[];
          pinned: boolean;
          changed_at: string;
        }> = [];

        if (checkpointMemory) {
          const links = store.getLinks(checkpointMemory.id);
          for (const link of links.slice(0, 5)) {
            const linkedMem = store.getMemoryById(link.target_id);
            if (linkedMem) {
              linked_memories.push({
                name: linkedMem.name,
                space: linkedMem.space_name,
                ref: `${linkedMem.space_name}:${linkedMem.name}`,
                tier: linkedMem.tier,
                tags: linkedMem.tags,
                pinned: linkedMem.pinned,
                changed_at: linkedMem.changed_at,
              });
            }
          }
        }

        const checkpoint = checkpointMemory
          ? {
              space: checkpointMemory.space_name,
              name: checkpointMemory.name,
              tier: checkpointMemory.tier as Tier,
              tags: checkpointMemory.tags,
              content: JSON.parse(checkpointMemory.content),
              linked_memories,
              updated_at: checkpointMemory.updated_at,
            }
          : null;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(checkpoint, null, 2),
            },
          ],
          checkpoint,
        };
      },
    },

    checkpoint_query: {
      schema: CheckpointQuerySchema,
      description: CHECKPOINT_TOOL_DESCRIPTIONS.checkpoint_query,
      annotations: { readOnlyHint: true },
      handler: async (args: unknown) => {
        const parsed = CheckpointQuerySchema.parse(args ?? {});

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

        // Filter by tag if provided
        if (parsed.tag) {
          checkpoints = checkpoints.filter(m => m.tags.includes(parsed.tag!));
        }

        // Filter by date range if provided
        if (parsed.from) {
          const fromDate = new Date(parsed.from);
          checkpoints = checkpoints.filter(m => new Date(m.updated_at) >= fromDate);
        }
        if (parsed.to) {
          const toDate = new Date(parsed.to);
          toDate.setHours(23, 59, 59, 999); // End of day
          checkpoints = checkpoints.filter(m => new Date(m.updated_at) <= toDate);
        }

        // Sort by updated_at descending
        checkpoints.sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );

        // Apply pagination
        const total = checkpoints.length;
        const paginatedCheckpoints = checkpoints.slice(parsed.offset, parsed.offset + parsed.limit);

        // Fetch full content for each checkpoint to parse goal/pending
        const checkpointDetails = await Promise.all(
          paginatedCheckpoints.map(async m => {
            const full = store.getMemoryById(m.id);
            let parsedContent: { goal?: string; pending?: string } = {};
            if (full?.content) {
              try {
                parsedContent = JSON.parse(full.content);
              } catch {
                // Ignore parse errors
              }
            }
            const pending = String(parsedContent.pending ?? '');
            return {
              name: m.name,
              goal: parsedContent.goal ?? '',
              pending: pending.length > 50 ? pending.slice(0, 50) + '…' : pending,
              updatedAt: m.updated_at,
              tags: m.tags,
            };
          })
        );

        return {
          content: [
            {
              type: 'text',
              text: `Found ${total} checkpoint(s).`,
            },
          ],
          checkpoints: checkpointDetails,
          total,
          limit: parsed.limit,
          offset: parsed.offset,
        };
      },
    },
  };
}
