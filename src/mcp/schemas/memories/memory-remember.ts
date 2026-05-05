import { z } from 'zod';

export const MemoryRememberSchema = z.object({
  space: z.string().min(1).describe('Space to save memory to. Must exist first.'),
  name: z.string().min(1).describe('Memory name/title.'),
  content: z.string().min(1).describe('Memory content.'),
  tags: z.array(z.string()).min(1).describe('Tags (at least 1 required).'),
  tier: z.number().int().min(1).max(3).optional().describe('Optional tier: 1=hot, 2=warm, 3=cold.'),
  links_to: z
    .array(z.string())
    .optional()
    .describe(
      'References to existing memories this one relates to, in "space:name" format or bare "name" (resolves in same space).'
    ),
});
