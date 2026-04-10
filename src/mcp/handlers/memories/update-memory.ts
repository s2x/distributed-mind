import type { MindStore } from '../../../store/mind-store';
import { stripMemoryResponseFields } from '../../helpers/memory-response';
import { buildYamlContent } from '../../helpers/yaml-response';
import { MemoryUpdateSchema } from '../../schemas/memories/update-memory';

export function updateMemoryHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = MemoryUpdateSchema.parse(args ?? {});
    if (!parsed.space || !parsed.name) {
      throw new Error('Both space and name are required.');
    }

    const existing = store.getMemory(parsed.space, parsed.name);
    if (!existing) {
      throw new Error(`Memory "${parsed.name}" not found in space "${parsed.space}".`);
    }

    if (parsed.newName !== undefined || parsed.content !== undefined) {
      await store.updateMemory(existing.id, {
        name: parsed.newName,
        content: parsed.content,
      });
    }

    if (parsed.tags !== undefined) {
      store.setMemoryTags(existing.id, parsed.tags);
    }

    const memory = store.getMemoryById(existing.id);
    return buildYamlContent({
      memory: memory ? stripMemoryResponseFields(memory) : undefined,
    });
  };
}
