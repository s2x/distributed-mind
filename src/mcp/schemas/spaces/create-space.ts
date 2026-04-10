import { z } from 'zod';

export const SpaceCreateSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe('Space name. Use projects/<repo>, user/preferences, or sessions/<repo>.'),
  description: z.string().min(1).describe('Description of the space purpose.'),
  tags: z.array(z.string()).min(1).describe('Tags (at least 1 required).'),
});
