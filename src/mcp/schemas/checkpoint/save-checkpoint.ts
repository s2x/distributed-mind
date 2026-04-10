import { z } from 'zod';

export const CheckpointSaveSchema = z.object({
  space: z.string().min(1).describe('Working space name.'),
  goal: z.string().optional().describe('Current goal or task.'),
  pending: z.string().optional().describe('What remains to be done.'),
  notes: z.string().optional().describe('Additional context or notes.'),
  linked_memories: z
    .array(z.string())
    .optional()
    .describe(
      'Memory refs to link (e.g. "my-memory" or "space:name"). Linked memories are included in checkpoint recovery.'
    ),
});
