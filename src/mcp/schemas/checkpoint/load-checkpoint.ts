import { z } from 'zod';

export const CheckpointLoadSchema = z.object({
  space: z.string().describe('Working space name to recover checkpoint from.'),
  checkpointName: z
    .string()
    .describe(
      'Name of the specific checkpoint to load. Use checkpoint_query first to find available checkpoints.'
    ),
});
