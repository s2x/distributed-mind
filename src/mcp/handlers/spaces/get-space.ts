import type { MindStore } from '../../../store/mind-store';
import { buildYamlContent } from '../../helpers/yaml-response';
import { SpaceGetSchema } from '../../schemas/spaces/get-space';

export function getSpaceHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = SpaceGetSchema.parse(args ?? {});
    if (!parsed.name) {
      throw new Error('Space name is required.');
    }

    const space = store.getSpace(parsed.name);
    if (!space) {
      throw new Error(`Space "${parsed.name}" does not exist.`);
    }

    const hot_memories = store
      .getHotMemories(parsed.name)
      .filter(memory => !memory.tags?.includes('checkpoint'))
      .map(({ id: _id, ...rest }) => rest);

    return buildYamlContent({
      space,
      hot_memories,
    });
  };
}
