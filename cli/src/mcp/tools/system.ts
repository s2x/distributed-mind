import { z } from 'zod';
import { renderSystemInstructions } from '../../cli/system-instructions';

const SystemInstructionsSchema = z.object({});

const FULL_INSTRUCTIONS = renderSystemInstructions();

export function createSystemTools() {
    return {
        system_instructions: {
            schema: SystemInstructionsSchema,
            description:
                'CALL THIS FIRST before using any other mind tool. Returns the complete mind usage protocol: space naming, tagging, linking, tier system, and session workflow. Without this, you will use the tools incorrectly.',
            annotations: { readOnlyHint: true },
            handler: async () => {
                return {
                    content: [{ type: 'text', text: FULL_INSTRUCTIONS }],
                    instructions_version: '1.2.0',
                };
            },
        },
    };
}
