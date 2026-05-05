import type { MindStore } from '../../../store/mind-store';
import {
  applyCheckpointFilters,
  applyCheckpointSortAndPagination,
  fetchAllCheckpointMemories,
  fetchCheckpointSummaries,
} from '../../helpers/checkpoint-query';
import { buildYamlContent, type SoftError } from '../../helpers/yaml-response';
import { CheckpointQuerySchema } from '../../schemas/checkpoint/query-checkpoints';

export function queryCheckpointsHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = CheckpointQuerySchema.parse(args ?? {});

    if (!parsed.space) {
      throw new Error('Space is required.');
    }

    const space = parsed.space;

    if (!(await store.getSpace(space))) {
      const error: SoftError = {
        code: 'space_not_found',
        message: `Space "${space}" not found.`,
      };

      return buildYamlContent({
        checkpoints: [],
        total: 0,
        limit: parsed.limit,
        offset: parsed.offset,
        error,
      });
    }

    const checkpoints = await fetchAllCheckpointMemories(store, space);
    const filtered = applyCheckpointFilters(
      checkpoints,
      parsed.status,
      parsed.tag,
      parsed.from,
      parsed.to
    );
    const { items: paginated, total } = applyCheckpointSortAndPagination(
      filtered,
      parsed.offset,
      parsed.limit
    );
    const checkpointSummaries = await fetchCheckpointSummaries(store, paginated);

    return buildYamlContent({
      checkpoints: checkpointSummaries,
      total,
      limit: parsed.limit,
      offset: parsed.offset,
      error: null,
    });
  };
}
