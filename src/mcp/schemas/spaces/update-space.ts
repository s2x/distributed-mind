import { z } from 'zod';

export const SpaceUpdateSchema = z.object({
  name: z.string().min(1).describe('Space name to update.'),
  description: z.string().optional().describe('New description.'),
  tags: z.array(z.string()).optional().describe('New tags array (replaces all existing).'),
});
