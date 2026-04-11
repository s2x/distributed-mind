import { z } from 'zod';

export const StatusSchema = z.object({
  space: z.string().optional().describe('Space name for space-specific status.'),
});
