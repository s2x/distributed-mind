import type { MindStore } from '../../../store/mind-store';
import { SpaceDeleteSchema } from '../../schemas/spaces/delete-space';

export function deleteSpaceHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = SpaceDeleteSchema.parse(args ?? {});
    if (!parsed.name) {
      throw new Error('Space name is required.');
    }

    store.deleteSpace(parsed.name);
    return {
      content: [{ type: 'text', text: `Space "${parsed.name}" deleted.` }],
    };
  };
}
