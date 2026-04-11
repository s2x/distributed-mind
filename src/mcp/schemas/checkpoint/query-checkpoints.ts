import { z } from 'zod';

export const CheckpointQuerySchema = z.object({
  space: z.string().describe('Working space name.'),
  status: z
    .enum(['active', 'completed', 'all'])
    .optional()
    .describe('Filter: active, completed, or all.'),
  from: z.string().optional().describe('Start date (YYYY-MM-DD).'),
  to: z.string().optional().describe('End date (YYYY-MM-DD).'),
  tag: z.string().optional().describe('Filter by tag.'),
  limit: z.number().optional().default(25).describe('Max results (default: 25).'),
  offset: z.number().optional().default(0).describe('Zero-based offset (default: 0).'),
});
