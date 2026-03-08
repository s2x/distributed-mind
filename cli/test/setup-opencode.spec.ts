import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSetup } from '../src/cli/setup';

const OPENCODE_PROTOCOL_SOURCE_PATH = join(
    import.meta.dir,
    '..',
    'src',
    'resources',
    'protocols',
    'opencode-memory-protocol.md'
);

let previousHome = '';
let tempHome = '';

beforeEach(() => {
    previousHome = process.env.HOME ?? '';
    tempHome = mkdtempSync(join(tmpdir(), 'mind-opencode-setup-'));
    process.env.HOME = tempHome;
});

afterEach(() => {
    process.env.HOME = previousHome;
    if (tempHome && existsSync(tempHome)) {
        rmSync(tempHome, { recursive: true, force: true });
    }
});

describe('OpenCode setup integration', () => {
    test('is non-destructive and injects memory protocol instructions', async () => {
        const opencodeDir = join(tempHome, '.config', 'opencode');
        const configPath = join(opencodeDir, 'opencode.json');

        const existing = {
            theme: 'dark',
            mcp: {
                github: {
                    command: 'npx',
                    args: ['-y', '@modelcontextprotocol/server-github'],
                },
            },
            instructions: ['AGENTS.md'],
            customKey: { keep: true },
        };

        mkdirSync(opencodeDir, { recursive: true });
        writeFileSync(configPath, JSON.stringify(existing, null, 2));

        await runSetup('opencode');

        const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, any>;

        expect(parsed.theme).toBe('dark');
        expect(parsed.customKey.keep).toBe(true);
        expect(parsed.mcp.github.command).toBe('npx');
        const expectedMindPath = join(import.meta.dir, '..', '..', 'mind');
        expect(parsed.mcp.mind.type).toBe('local');
        expect(parsed.mcp.mind.command).toEqual([expectedMindPath, 'mcp']);
        expect(parsed.mcp.mind.enabled).toBe(true);

        expect(Array.isArray(parsed.instructions)).toBe(true);
        expect(parsed.instructions).toContain('AGENTS.md');

        const expectedInstructionPath = join(
            tempHome,
            '.config',
            'opencode',
            'instructions',
            'mind-memory-protocol.md'
        );
        expect(parsed.instructions[0]).toBe(expectedInstructionPath);

        const injectedPath = parsed.instructions.find((item: string) => item === expectedInstructionPath);
        expect(injectedPath).toBeDefined();
        expect(existsSync(injectedPath)).toBe(true);

        const injectedText = readFileSync(injectedPath, 'utf-8');
        const sourceText = readFileSync(OPENCODE_PROTOCOL_SOURCE_PATH, 'utf-8');
        expect(injectedText).toBe(sourceText);
        expect(injectedText).toContain('Mind Memory Protocol');
        expect(injectedText).toContain('post-compaction');
        expect(injectedText).toContain('mind_system_instructions');
    });

    test('is idempotent for repeated setup runs', async () => {
        await runSetup('opencode');
        await runSetup('opencode');

        const configPath = join(tempHome, '.config', 'opencode', 'opencode.json');
        const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, any>;

        const mindEntries = Object.keys(parsed.mcp).filter((k) => k === 'mind');
        expect(mindEntries.length).toBe(1);

        const expectedInstructionPath = join(
            tempHome,
            '.config',
            'opencode',
            'instructions',
            'mind-memory-protocol.md'
        );
        const instructionEntries = (parsed.instructions as string[]).filter((item) => item === expectedInstructionPath);
        expect(instructionEntries.length).toBe(1);
        expect(parsed.instructions[0]).toBe(expectedInstructionPath);
    });

    test('writes OpenCode prudent automation plugin by default', async () => {
        await runSetup('opencode');

        const pluginPath = join(tempHome, '.config', 'opencode', 'plugins', 'mind-automation.js');
        expect(existsSync(pluginPath)).toBe(true);
    });

    test('writes OpenCode prudent automation plugin with required handlers', async () => {
        await runSetup('opencode');

        const pluginPath = join(tempHome, '.config', 'opencode', 'plugins', 'mind-automation.js');
        expect(existsSync(pluginPath)).toBe(true);

        const pluginText = readFileSync(pluginPath, 'utf-8');
        expect(pluginText).toContain('session.created');
        expect(pluginText).toContain('session.compacted');
        expect(pluginText).toContain('experimental.session.compacting');
        expect(pluginText).toContain('checkpoint set');
        expect(pluginText).toContain('checkpoint recover');
    });
});
