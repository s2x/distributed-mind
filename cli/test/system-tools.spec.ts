import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSystemTools } from '../src/mcp/tools/system';

const SYSTEM_INSTRUCTIONS_SOURCE_PATH = join(
    import.meta.dir,
    '..',
    'src',
    'resources',
    'protocols',
    'mind-system-instructions.md'
);

describe('MCP System Tools', () => {
    test('system_instructions should load protocol text from markdown source file', async () => {
        const tools = createSystemTools();
        const response = await tools.system_instructions.handler();
        const sourceText = readFileSync(SYSTEM_INSTRUCTIONS_SOURCE_PATH, 'utf-8');

        expect(response.instructions_version).toBe('1.1.0');
        expect(response.content[0]?.type).toBe('text');
        expect(response.content[0]?.text).toBe(sourceText);
    });
});
