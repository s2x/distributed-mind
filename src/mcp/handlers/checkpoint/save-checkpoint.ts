import {
  buildCheckpointContent,
  fetchCheckpointContent,
} from '../../../helpers/checkpoint-content';
import { resolveRefWithFallback } from '../../../helpers/memory-ref-resolver';
import type { MindStore } from '../../../store/mind-store';
import type { Tier } from '../../../types';
import { buildYamlContent } from '../../helpers/yaml-response';
import { CheckpointSaveSchema } from '../../schemas/checkpoint/save-checkpoint';

export function saveCheckpointHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = CheckpointSaveSchema.parse(args ?? {});

    if (!parsed.space) {
      throw new Error('Space is required.');
    }

    const space = parsed.space;

    if (!(await store.getSpace(space))) {
      throw new Error(`Space "${space}" not found.`);
    }

    const existingCheckpoints = await store.listMemories(space, { tag: 'checkpoint' });
    const activeCheckpoint = existingCheckpoints.find(memory => memory.tags.includes('active'));

    let checkpoint;
    if (activeCheckpoint) {
      const memory = await store.getMemoryById(activeCheckpoint.id);
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
          checkpoint = await store.getMemoryById(activeCheckpoint.id);
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
          const resolved = await resolveRefWithFallback(store, ref, space);
          await store.link(checkpoint.id, resolved.id, 'related');
        } catch {
          // Ignore link errors
        }
      }
    }

    return buildYamlContent({
      checkpoint: checkpoint
        ? {
            space,
            name: checkpoint.name,
            tier: checkpoint.tier,
            tags: checkpoint.tags,
          }
        : undefined,
    });
  };
}
