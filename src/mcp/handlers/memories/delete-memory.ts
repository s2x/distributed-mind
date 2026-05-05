import type { MindStore } from '../../../store/mind-store';
import { MemoryDeleteSchema } from '../../schemas/memories/delete-memory';

export function deleteMemoryHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = MemoryDeleteSchema.parse(args ?? {});
    if (!parsed.space || !parsed.name) {
      throw new Error('Both space and memory name are required.');
    }

    await store.deleteMemoryByName(parsed.space, parsed.name);
    return {
      content: [
        { type: 'text', text: `Memory "${parsed.name}" deleted from space "${parsed.space}".` },
      ],
    };
  };
}
