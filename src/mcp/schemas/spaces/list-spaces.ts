import { z } from 'zod';

export const SpaceListSchema = z.object({
  tag: z.string().optional().describe('Filter by tag.'),
});
