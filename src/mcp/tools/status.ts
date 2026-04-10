import type { MindStore } from '../../store/mind-store';
import { getStatusHandler } from '../handlers/status/get-status';
import { StatusSchema } from '../schemas/status/get-status';
import type { ToolDefinition } from '../tool-types';

export function createStatusTools(store: MindStore): Record<string, ToolDefinition> {
  return {
    status: {
      schema: StatusSchema,
      description:
        'Get storage status: memory counts per tier, space usage, and link totals. Use to understand current storage state before cleanup or reorganization.',
      annotations: { readOnlyHint: true },
      handler: getStatusHandler(store),
    },
  };
}
