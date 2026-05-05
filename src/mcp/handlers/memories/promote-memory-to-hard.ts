import type { MindStore } from '../../../store/mind-store';
import { buildYamlContent } from '../../helpers/yaml-response';
import { MemoryPromoteToHardSchema } from '../../schemas/memories/memory-promote-to-hard';

export function promoteMemoryToHardHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = MemoryPromoteToHardSchema.parse(args ?? {});
    if (!parsed.space || !parsed.name) {
      throw new Error('Both space and memory name are required.');
    }

    await store.promoteToHard(parsed.space, parsed.name);

    return buildYamlContent({
      space: parsed.space,
      name: parsed.name,
      persistence: 'hard',
      status: 'promoted',
    });
  };
}
