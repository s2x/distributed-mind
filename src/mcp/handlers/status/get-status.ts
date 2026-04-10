import type { MindStore } from '../../../store/mind-store';
import { buildYamlContent } from '../../helpers/yaml-response';
import { StatusSchema } from '../../schemas/status/get-status';

export function getStatusHandler(store: MindStore) {
  return async (args: unknown) => {
    const parsed = StatusSchema.parse(args ?? {});
    const status = store.getStatus(parsed.space);

    return buildYamlContent({
      status,
    });
  };
}
