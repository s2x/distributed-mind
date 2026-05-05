import type { MindStore } from '../../../store/mind-store';
import { buildYamlContent } from '../../helpers/yaml-response';
import { MemoryDemoteToSoftSchema } from '../../schemas/memories/memory-demote-to-soft';

export function demoteMemoryToSoftHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = MemoryDemoteToSoftSchema.parse(args ?? {});
    if (!parsed.space || !parsed.name) {
      throw new Error('Both space and memory name are required.');
    }

    await store.demoteToSoft(parsed.space, parsed.name);

    return buildYamlContent({
      space: parsed.space,
      name: parsed.name,
      persistence: 'soft',
      status: 'demoted',
    });
  };
}
