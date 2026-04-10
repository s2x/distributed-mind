import { z } from 'zod';

const EMPTY_OBJECT_SCHEMA = { type: 'object', properties: {} };

export function zodToJsonSchema(schema: z.ZodType | undefined): Record<string, unknown> {
  if (!schema) {
    return EMPTY_OBJECT_SCHEMA;
  }

  return z.toJSONSchema(schema, { io: 'input' });
}
