import { z } from 'zod';

import { completeCheckpoint } from '../../checkpoint/checkpoint-done';
import { buildCheckpointContent, fetchCheckpointContent } from '../../helpers/checkpoint-content';
import { buildLinkedMemoriesArray } from '../../helpers/link-building';
import type { MindStore } from '../../store/mind-store';
import type { MemorySummary, Tier } from '../../types';

import { resolveRefWithFallback } from './links';

// ── Types ──

/**
 * Checkpoint summary returned by checkpoint_query.
 */
interface CheckpointSummary {
  name: string;
  goal: string;
  pending: string;
  updatedAt: string;
  tags: string[];
}

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

// ── Helper functions ──

/**
 * Apply status, tag, and date filters to a list of checkpoint memories.
 */
function applyCheckpointFilters(
  checkpoints: MemorySummary[],
  status?: string,
  tag?: string,
  from?: string,
  to?: string
): MemorySummary[] {
  let filtered = checkpoints;

  if (status && status !== 'all') {
    filtered = filtered.filter(m => m.tags.includes(status!));
  }

  if (tag) {
    filtered = filtered.filter(m => m.tags.includes(tag!));
  }

  if (from) {
    const fromDate = new Date(from);
    filtered = filtered.filter(m => new Date(m.updated_at) >= fromDate);
  }

  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999); // End of day
    filtered = filtered.filter(m => new Date(m.updated_at) <= toDate);
  }

  return filtered;
}

/**
 * Sort checkpoints by updated_at descending and apply pagination.
 */
function applyCheckpointSortAndPagination(
  checkpoints: MemorySummary[],
  offset: number,
  limit: number
): { items: MemorySummary[]; total: number } {
  const sorted = [...checkpoints].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  const total = sorted.length;
  const items = sorted.slice(offset, offset + limit);
  return { items, total };
}

/**
 * Fetch full content for paginated checkpoints and parse goal/pending.
 */
async function fetchCheckpointSummaries(
  store: MindStore,
  checkpoints: MemorySummary[]
): Promise<CheckpointSummary[]> {
  return Promise.all(
    checkpoints.map(m => {
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

        const existingCheckpoints = store.listMemories(space, { tag: 'checkpoint' });
        const activeCheckpoint = existingCheckpoints.find(m => m.tags.includes('active'));

        let checkpoint;
        if (activeCheckpoint) {
          const memory = store.getMemoryById(activeCheckpoint.id);
          if (memory) {
            const existingContent = fetchCheckpointContent(memory);
            if (existingContent) {
              await store.updateMemory(activeCheckpoint.id, {
                content: buildCheckpointContent(
                  parsed.goal ?? '',
                  parsed.pending ?? '',
                  parsed.notes ?? '',
                  existingContent.createdAt
                ),
              });
              checkpoint = store.getMemoryById(activeCheckpoint.id);
            }
          }
        } else {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          checkpoint = await store.addMemory(
            space,
            `checkpoint-${timestamp}`,
            buildCheckpointContent(parsed.goal ?? '', parsed.pending ?? '', parsed.notes ?? ''),
            {
              tags: ['checkpoint', 'active'],
              tier: 1 as Tier,
            }
          );
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
        if (!checkpointMemory) {
          throw new Error(`Checkpoint "${data.checkpointName}" could not be loaded.`);
        }

        // Use shared helpers for building linked_memories and parsing content
        const linked_memories = buildLinkedMemoriesArray(store, checkpointMemory.id, 5);
        const checkpointContent = fetchCheckpointContent(checkpointMemory);

        const checkpoint = {
          space: checkpointMemory.space_name,
          name: checkpointMemory.name,
          tier: checkpointMemory.tier as Tier,
          tags: checkpointMemory.tags,
          content: checkpointContent,
          linked_memories,
          updated_at: checkpointMemory.updated_at,
        };

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
        const checkpoints = store.queryMemories({
          space,
          tag: 'checkpoint',
          limit: 500,
        });

        // Apply filters
        const filtered = applyCheckpointFilters(
          checkpoints,
          parsed.status,
          parsed.tag,
          parsed.from,
          parsed.to
        );

        // Sort and paginate
        const { items: paginated, total } = applyCheckpointSortAndPagination(
          filtered,
          parsed.offset,
          parsed.limit
        );

        // Fetch and parse goal/pending for each checkpoint
        const checkpointSummaries = await fetchCheckpointSummaries(store, paginated);

        return {
          content: [
            {
              type: 'text',
              text: `Found ${total} checkpoint(s).`,
            },
          ],
          checkpoints: checkpointSummaries,
          total,
          limit: parsed.limit,
          offset: parsed.offset,
        };
      },
    },
  };
}
