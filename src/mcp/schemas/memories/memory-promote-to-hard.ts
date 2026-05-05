import { z } from 'zod';

export const MemoryPromoteToHardSchema = z.object({
  space: z.string().min(1).describe('Space containing the memory.'),
  name: z.string().min(1).describe('Memory name to promote to hard persistence.'),
});
