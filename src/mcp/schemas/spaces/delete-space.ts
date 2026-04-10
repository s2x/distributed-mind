import { z } from 'zod';

export const SpaceDeleteSchema = z.object({
  name: z.string().min(1).describe('Space name to delete.'),
});
