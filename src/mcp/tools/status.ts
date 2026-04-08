import { z } from 'zod';

import type { MindStore } from '../../store/mind-store';

const StatusSchema = z.object({
  space: z.string().optional().describe('Space name for space-specific status.'),
});

export function createStatusTools(store: MindStore) {
  return {
    status: {
      schema: StatusSchema,
      description:
        'Get storage status: memory counts per tier, space usage, and link totals. Use to understand current storage state before cleanup or reorganization.',
      annotations: { readOnlyHint: true },
      handler: async (args: unknown) => {
        const parsed = StatusSchema.parse(args ?? {});
        const status = store.getStatus(parsed.space);

        return {
          content: [
            {
              type: 'text',
              text: parsed.space
                ? `Status for space "${parsed.space}" retrieved.`
                : `Global mind status retrieved.`,
            },
          ],
          status,
        };
      },
    },
  };
}
