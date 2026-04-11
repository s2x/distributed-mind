import { z } from 'zod';

export const MemoryReadSchema = z.object({
  space: z.string().min(1).describe('Space containing the memory.'),
  name: z.string().min(1).describe('Memory name to read.'),
  noPromote: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, inspect the memory without side effects: no access count bump, no tier promotion. Use when browsing or checking content without intending to "use" the memory.'
    ),
});
