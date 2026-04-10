import { z } from 'zod';

export const LinkDeleteSchema = z.object({
  sourceRef: z
    .string()
    .describe('Source memory ref of the link to remove ("space:name" or bare "name").'),
  targetRef: z
    .string()
    .describe('Target memory ref of the link to remove ("space:name" or bare "name").'),
});
