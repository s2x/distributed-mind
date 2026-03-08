import { z } from 'zod';
import * as path from 'node:path';
import { loadMarkdownResource } from '../../helpers/markdown-resource';

const SystemInstructionsSchema = z.object({});

const SYSTEM_INSTRUCTIONS_SOURCE_PATH = path.resolve(
    __dirname,
    '..',
    '..',
    'resources',
    'protocols',
    'mind-system-instructions.md'
);

const FULL_INSTRUCTIONS = loadMarkdownResource(SYSTEM_INSTRUCTIONS_SOURCE_PATH);

export function createSystemTools() {
    return {
        system_instructions: {
            schema: SystemInstructionsSchema,
            handler: async () => {
                return {
                    content: [{ type: 'text', text: FULL_INSTRUCTIONS }],
                    instructions_version: '1.1.0',
                };
            },
        },
    };
}
