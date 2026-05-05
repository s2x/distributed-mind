import type { MindStore } from '../../../store/mind-store';
import { presentSpaceResponse } from '../../helpers/memory-response';
import { buildYamlContent } from '../../helpers/yaml-response';
import { SpaceCreateSchema } from '../../schemas/spaces/create-space';

export function createSpaceHandler(store: MindStore) {
  return async (args: unknown) => {
    let parsed;

    try {
      parsed = SpaceCreateSchema.parse(args);
    } catch (e: any) {
      const msg = e.message ?? '';
      if (msg.includes('"code":"invalid_type"') || msg.includes('"invalid_type"')) {
        throw new Error('tags is required');
      }
      if (msg.includes('"code":"too_small"') || msg.includes('"too_small"')) {
        throw new Error('at least 1 tag');
      }
      throw new Error(`Invalid arguments: ${msg}`);
    }

    await store.createSpace(parsed.name, parsed.description, parsed.tags);
    const space = await store.getSpace(parsed.name);
    return buildYamlContent({
      space: space ? presentSpaceResponse(space) : undefined,
    });
  };
}
