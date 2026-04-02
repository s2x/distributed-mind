import { completeCheckpoint } from '../../checkpoint/checkpoint-done';
import { style } from '../../helpers/style';
import { resolveRefWithFallback } from '../../mcp/tools/links';
import { ArgParser } from '../arg-parser';

import type { CommandGroup } from './types';

const p = ArgParser.param.bind(ArgParser);

const SET = new ArgParser(
  ['checkpoint set|cp set', p('space'), p('goal'), p('pending')],
  'Creates or updates a checkpoint for the current work session',
  [
    { name: 'notes', alias: 'n', hasValue: true },
    { name: 'linked-memories', alias: 'l', hasValue: true },
  ]
);

const COMPLETE = new ArgParser(
  ['checkpoint complete|cp complete|checkpoint done|cp done', p('space'), p('name'), p('what')],
  'Marks a checkpoint as completed',
  []
);

const RECOVER = new ArgParser(
  ['checkpoint recover|cp recover', p('space')],
  'Recovers a checkpoint by name (use checkpoint list to find available checkpoints)',
  [{ name: 'name', alias: 'n', hasValue: true }]
);

const LIST = new ArgParser(
  ['checkpoint list|cp list', p('space')],
  'Lists all checkpoints for a space',
  [{ name: 'status', alias: 'S', hasValue: true }]
);

export const checkpointGroup: CommandGroup = {
  name: 'Checkpoint',
  helpEntries: [SET, COMPLETE, RECOVER, LIST],
  commands: [
    {
      matches: args => SET.matches(args),
      execute: async (args, store, logger) => {
        const params = SET.getParams(args);
        const flags = SET.getFlags(args);
        const space = params.space;
        const goal = params.goal;
        const pending = params.pending;
        const notes = flags.notes ? String(flags.notes) : undefined;
        const linkedMemoriesFlag = flags['linked-memories']
          ? String(flags['linked-memories'])
          : undefined;

        // Verify the space exists
        if (!store.getSpace(space)) {
          logger.logInfo(style(`❌ Space "${space}" not found`, ['red']));
          return;
        }

        // Build checkpoint content as JSON
        const content = JSON.stringify(
          {
            goal,
            pending,
            notes: notes || '',
            createdAt: new Date().toISOString(),
          },
          null,
          2
        );

        // Check if there's already an active checkpoint
        const existingCheckpoints = store.listMemories(space, { tag: 'checkpoint' });
        const activeCheckpoint = existingCheckpoints.find(m => m.tags.includes('active'));

        let checkpoint;
        if (activeCheckpoint) {
          // Update existing active checkpoint
          const memory = store.getMemoryById(activeCheckpoint.id);
          if (memory) {
            const existingContent = JSON.parse(memory.content);
            existingContent.goal = goal;
            existingContent.pending = pending;
            existingContent.notes = notes || '';
            existingContent.updatedAt = new Date().toISOString();

            await store.updateMemory(activeCheckpoint.id, {
              content: JSON.stringify(existingContent, null, 2),
            });
            checkpoint = store.getMemoryById(activeCheckpoint.id);
          }
        } else {
          // Create new checkpoint
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          checkpoint = await store.addMemory(space, `checkpoint-${timestamp}`, content, {
            tags: ['checkpoint', 'active'],
            tier: 1,
          });
        }

        // Handle linked_memories: parse comma-separated refs and create links
        if (linkedMemoriesFlag && checkpoint) {
          const refs = linkedMemoriesFlag
            .split(',')
            .map(r => r.trim())
            .filter(Boolean);
          for (const ref of refs) {
            try {
              const resolved = resolveRefWithFallback(store, ref, space);
              store.link(checkpoint.id, resolved.id, 'related');
            } catch {
              // Ignore link errors
            }
          }
        }

        const status = activeCheckpoint ? 'updated' : 'created';
        logger.logInfo(style(`Checkpoint ${status} in "${space}"`, ['bold', 'green']));
        if (checkpoint) {
          logger.logInfo(style(`   Name: ${checkpoint.name}`, ['dim']));
        }
      },
    },
    {
      matches: args => COMPLETE.matches(args),
      execute: async (args, store, logger) => {
        const params = COMPLETE.getParams(args);
        const space = params.space;
        const checkpointName = params.name;
        const summary = params.what ?? '';

        let memory;
        if (checkpointName) {
          memory = store.getMemory(space, checkpointName);
        } else {
          // Find active checkpoint
          const checkpoints = store.listMemories(space, { tag: 'checkpoint' });
          const active = checkpoints.find(m => m.tags.includes('active'));
          if (active) {
            memory = store.getMemoryById(active.id);
          }
        }

        if (!memory) {
          logger.logInfo(style(`Checkpoint not found in "${space}"`, ['red']));
          return;
        }

        // Transform checkpoint into session memory (same behavior as MCP checkpoint_done)
        const result = await completeCheckpoint(store, space, memory.id, summary);

        logger.logInfo(
          style(
            `Checkpoint transformed into session memory "${result.sessionMemory.name}" in "${result.sessionMemory.space}"`,
            ['bold', 'green']
          )
        );
      },
    },
    {
      matches: args => RECOVER.matches(args),
      execute: async (args, store, logger) => {
        const params = RECOVER.getParams(args);
        const flags = RECOVER.getFlags(args);
        const space = params.space;
        const checkpointName = flags.name ? String(flags.name) : undefined;

        if (!checkpointName) {
          logger.logInfo(
            style(
              'Checkpoint name is required. Use "checkpoint list" first to find available checkpoints.',
              ['yellow']
            )
          );
          return;
        }

        // Find checkpoint by name
        let checkpointMemory = store.getMemory(space, checkpointName);
        if (!checkpointMemory) {
          logger.logInfo(style(`Checkpoint "${checkpointName}" not found in "${space}"`, ['red']));
          return;
        }
        checkpointMemory = store.getMemoryById(checkpointMemory.id);
        if (!checkpointMemory) {
          logger.logInfo(style(`Checkpoint "${checkpointName}" could not be loaded`, ['red']));
          return;
        }

        // Build linked_memories in enriched format
        const linked_memories: Array<{
          name: string;
          space: string;
          ref: string;
          tier: number;
          tags: string[];
          pinned: boolean;
          changed_at: string;
        }> = [];

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

        const checkpoint = {
          space: checkpointMemory.space_name,
          name: checkpointMemory.name,
          tier: checkpointMemory.tier,
          tags: checkpointMemory.tags,
          content: JSON.parse(checkpointMemory.content),
          linked_memories,
          updated_at: checkpointMemory.updated_at,
        };

        logger.logInfo(JSON.stringify(checkpoint, null, 2));
      },
    },
    {
      matches: args => LIST.matches(args),
      execute: async (args, store, logger) => {
        const params = LIST.getParams(args);
        const flags = LIST.getFlags(args);
        const space = params.space;
        const status = flags.status ? String(flags.status) : undefined;

        if (!store.getSpace(space)) {
          logger.logInfo(style(`No checkpoint space found for "${space}"`, ['yellow']));
          return;
        }

        // Get all checkpoints
        let checkpoints = store.listMemories(space, { tag: 'checkpoint' });

        // Filter by status if specified
        if (status && status !== 'all') {
          checkpoints = checkpoints.filter(m => m.tags.includes(status));
        }

        // Sort by updated_at descending
        checkpoints.sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );

        if (checkpoints.length === 0) {
          logger.logInfo(style(`No checkpoints found`, ['yellow']));
          return;
        }

        logger.logInfo(style(`Checkpoints for "${space}":`, ['bold', 'cyan']));
        for (const cp of checkpoints) {
          const statusBadge = cp.tags.includes('active')
            ? style(' [active]', ['green'])
            : style(' [completed]', ['dim']);
          logger.logInfo(style(`   ${cp.name}${statusBadge}`, []));
          logger.logInfo(style(`       Updated: ${cp.updated_at}`, ['dim']));
        }
      },
    },
  ],
};
