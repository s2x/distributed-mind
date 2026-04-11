import { fetchCheckpointContent } from '../../../helpers/checkpoint-content';
import { buildLinkedMemoriesArray } from '../../../helpers/link-building';
import type { MindStore } from '../../../store/mind-store';
import type { Tier } from '../../../types';
import { buildYamlContent } from '../../helpers/yaml-response';
import { CheckpointLoadSchema } from '../../schemas/checkpoint/load-checkpoint';

function buildCheckpointResponseContent(
  checkpointContent: ReturnType<typeof fetchCheckpointContent>
): { goal: string; pending: string; notes: string } | null {
  if (!checkpointContent) {
    return null;
  }

  return {
    goal: checkpointContent.goal,
    pending: checkpointContent.pending,
    notes: checkpointContent.notes,
  };
}

export function loadCheckpointHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = CheckpointLoadSchema.safeParse(args ?? {});

    if (!parsed.success) {
      const checkpointNameIssue = parsed.error.issues.find(issue =>
        issue.path.includes('checkpointName')
      );
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

    let checkpointMemory = store.getMemory(data.space, data.checkpointName);
    if (!checkpointMemory) {
      throw new Error(`Checkpoint "${data.checkpointName}" not found in "${data.space}".`);
    }
    checkpointMemory = store.getMemoryById(checkpointMemory.id);
    if (!checkpointMemory) {
      throw new Error(`Checkpoint "${data.checkpointName}" could not be loaded.`);
    }

    const linked_memories = buildLinkedMemoriesArray(store, checkpointMemory.id);
    const checkpointContent = fetchCheckpointContent(checkpointMemory);

    const checkpoint = {
      space: checkpointMemory.space_name,
      name: checkpointMemory.name,
      tier: checkpointMemory.tier as Tier,
      tags: checkpointMemory.tags,
      content: buildCheckpointResponseContent(checkpointContent),
      linked_memories,
      changed_at: checkpointMemory.changed_at,
    };

    return buildYamlContent({
      checkpoint,
    });
  };
}
