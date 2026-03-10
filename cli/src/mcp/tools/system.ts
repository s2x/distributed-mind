import { z } from 'zod';
import { renderSystemInstructions } from '../../cli/system-instructions';

const SystemInstructionsSchema = z.object({});

const FULL_INSTRUCTIONS = renderSystemInstructions();

export function createSystemTools() {
    return {
        system_instructions: {
            schema: SystemInstructionsSchema,
            handler: async () => {
                return {
                    content: [{ type: 'text', text: FULL_INSTRUCTIONS }],
                    instructions_version: '1.2.0',
                };
            },
        },
    };
}
