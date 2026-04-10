import type { MindStore } from '../../../store/mind-store';
import { presentSpaceResponse } from '../../helpers/memory-response';
import { buildYamlContent } from '../../helpers/yaml-response';
import { SpaceUpdateSchema } from '../../schemas/spaces/update-space';

export function updateSpaceHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = SpaceUpdateSchema.parse(args ?? {});
    if (!parsed.name) {
      throw new Error('Space name is required.');
    }

    const updates: { description?: string; hidden?: boolean } = {};
    if (parsed.description !== undefined) {
      updates.description = parsed.description;
    }
    store.updateSpace(parsed.name, updates);

    if (parsed.tags !== undefined) {
      const currentSpace = store.getSpace(parsed.name);
      const currentTags = currentSpace?.tags ?? [];

      for (const tag of currentTags) {
        if (!parsed.tags.includes(tag)) {
          store.removeSpaceTag(parsed.name, tag);
        }
      }

      for (const tag of parsed.tags) {
        if (!currentTags.includes(tag)) {
          store.addSpaceTag(parsed.name, tag);
        }
      }
    }

    const space = store.getSpace(parsed.name);
    return buildYamlContent({
      space: space ? presentSpaceResponse(space) : undefined,
    });
  };
}
