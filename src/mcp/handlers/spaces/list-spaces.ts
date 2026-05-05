import type { MindStore } from '../../../store/mind-store';
import { buildYamlContent } from '../../helpers/yaml-response';
import { SpaceListSchema } from '../../schemas/spaces/list-spaces';

export function listSpacesHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = SpaceListSchema.parse(args ?? {});
    const spaces = await store.listSpaces(parsed.tag ? { tag: parsed.tag } : undefined);

    return buildYamlContent({
      spaces,
    });
  };
}
