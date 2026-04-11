import { z } from 'zod';

export const SpaceGetSchema = z.object({
  name: z.string().min(1).describe('Space name to retrieve.'),
});
