import { z } from 'zod';

export const CheckpointDoneSchema = z.object({
  space: z.string().describe('Working space name.'),
  checkpointName: z
    .string()
    .optional()
    .describe(
      'Name of the checkpoint to mark complete. If omitted, completes the active checkpoint.'
    ),
  summary: z.string().optional().describe('Summary of what was accomplished.'),
});
