import { getSystemInstructionsHandler } from '../handlers/system/get-system-instructions';
import { SystemInstructionsSchema } from '../schemas/system/get-system-instructions';
import type { ToolDefinition } from '../tool-types';

export function createSystemTools(): Record<string, ToolDefinition> {
  return {
    system_instructions: {
      schema: SystemInstructionsSchema,
      description:
        'Returns the complete mind usage protocol: space naming, tagging, linking, tier system, and session workflow. Must be called before using any other mind tool in a new session.',
      annotations: { readOnlyHint: true },
      handler: getSystemInstructionsHandler,
    },
  };
}
