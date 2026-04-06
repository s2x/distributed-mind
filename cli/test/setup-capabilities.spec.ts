import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { renderMemoryProtocol } from '../src/cli/memory-protocol';
import {
  getAgentCapabilityMatrix,
  getAgentCapabilities,
  listAgents,
  runSetup,
} from '../src/cli/setup';

let previousHome = '';
let previousClaudeHooksOptIn = '';
let tempHome = '';

beforeEach(() => {
  previousHome = process.env.HOME ?? '';
  previousClaudeHooksOptIn = process.env.MIND_SETUP_CLAUDE_ENABLE_HOOKS ?? '';
  tempHome = mkdtempSync(join(tmpdir(), 'mind-setup-capabilities-'));
  process.env.HOME = tempHome;
  delete process.env.MIND_SETUP_CLAUDE_ENABLE_HOOKS;
});

afterEach(() => {
  process.env.HOME = previousHome;
  if (previousClaudeHooksOptIn.length > 0) {
    process.env.MIND_SETUP_CLAUDE_ENABLE_HOOKS = previousClaudeHooksOptIn;
  } else {
    delete process.env.MIND_SETUP_CLAUDE_ENABLE_HOOKS;
  }
  if (tempHome && existsSync(tempHome)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

describe('Setup capability model', () => {
  test('declares explicit per-level capability status for each configured agent', () => {
    const matrix = getAgentCapabilityMatrix();
    expect(matrix.length).toBeGreaterThanOrEqual(6);

    const cursor = getAgentCapabilities('cursor');
    expect(cursor.L1_MCP.status).toBe('supported');
    expect(cursor.L2_INSTRUCTIONS.status).toBe('unverified');
    expect(cursor.L3_HOOKS.status).toBe('supported');

    const codex = getAgentCapabilities('codex');
    expect(codex.L1_MCP.status).toBe('supported');
    expect(codex.L2_INSTRUCTIONS.status).toBe('supported');
    expect(codex.L3_HOOKS.status).toBe('unsupported');

    const opencode = getAgentCapabilities('opencode');
    expect(opencode.L2_INSTRUCTIONS.status).toBe('supported');
    expect(opencode.L3_HOOKS.status).toBe('supported');

    const claude = getAgentCapabilities('claude-code');
    expect(claude.L2_INSTRUCTIONS.status).toBe('supported');
    expect(claude.L3_HOOKS.status).toBe('supported');
  });

  test('prints explicit capability diagnostics for Claude setup with supported L2/L3', async () => {
    const logSpy = spyOn(console, 'log');

    await runSetup('claude-code');

    const lines = logSpy.mock.calls.map(call => String(call[0]));
    expect(
      lines.some(
        line =>
          line.includes('L2 instruction/protocol injection') &&
          line.includes('supported') &&
          line.includes('fallback')
      )
    ).toBe(true);

    expect(
      lines.some(
        line =>
          line.includes('L3 hooks/session/compaction automation') &&
          line.includes('supported') &&
          line.includes('fallback')
      )
    ).toBe(true);
  });

  test('surfaces next-wave roadmap agents in capability matrix without setup wiring', () => {
    const matrix = getAgentCapabilityMatrix();
    const agentNames = matrix.map(entry => entry.agent);

    expect(agentNames).toContain('vscode');
    expect(agentNames).toContain('antigravity');
    expect(agentNames).toContain('kiro');
    expect(agentNames).toContain('openclaw');

    const vscode = matrix.find(entry => entry.agent === 'vscode');
    expect(vscode?.capabilities.L1_MCP.status).toBe('unverified');
    expect(vscode?.capabilities.L2_INSTRUCTIONS.status).toBe('unsupported');
    expect(vscode?.capabilities.L3_HOOKS.status).toBe('unsupported');

    const openclaw = matrix.find(entry => entry.agent === 'openclaw');
    expect(openclaw?.name).toContain('experimental');
    expect(openclaw?.capabilities.L1_MCP.status).toBe('unverified');
    expect(openclaw?.capabilities.L2_INSTRUCTIONS.status).toBe('unsupported');
    expect(openclaw?.capabilities.L3_HOOKS.status).toBe('unsupported');
    expect(openclaw?.capabilities.L1_MCP.fallback.toLowerCase()).toContain('experimental');
  });

  test('setup command output exposes capability statuses and evidence notes', () => {
    const logSpy = spyOn(console, 'log');

    listAgents();

    const lines = logSpy.mock.calls.map(call => String(call[0]));
    expect(lines.some(line => line.includes('Capability matrix'))).toBe(true);
    expect(lines.some(line => line.includes('cursor'))).toBe(true);
    expect(lines.some(line => line.includes('unverified'))).toBe(true);
    expect(lines.some(line => line.includes('evidence'))).toBe(true);
  });

  test('keeps Cursor L1 setup behavior while configuring managed global hooks artifacts', async () => {
    await runSetup('cursor');
    await runSetup('cursor');

    const configPath = join(tempHome, '.cursor', 'mcp.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, any>;
    expect(config.mcpServers.mind.url).toBe('http://localhost:7438/mcp');

    const hooksPath = join(tempHome, '.cursor', 'hooks.json');
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf-8')) as Record<string, any>;
    expect(Array.isArray(hooks.sessionStart)).toBe(true);
    expect(Array.isArray(hooks.preCompact)).toBe(true);
    expect(Array.isArray(hooks.stop)).toBe(true);

    const hookScriptPath = join(tempHome, '.cursor', 'hooks', 'mind-session-continuity.sh');
    expect(readFileSync(hookScriptPath, 'utf-8')).toContain('mind checkpoint set');

    const startMatches = (hooks.sessionStart as Array<Record<string, any>>).filter(
      entry => entry?.command === hookScriptPath
    );
    const preCompactMatches = (hooks.preCompact as Array<Record<string, any>>).filter(
      entry => entry?.command === hookScriptPath
    );
    const stopMatches = (hooks.stop as Array<Record<string, any>>).filter(
      entry => entry?.command === hookScriptPath
    );

    expect(startMatches.length).toBe(1);
    expect(preCompactMatches.length).toBe(1);
    expect(stopMatches.length).toBe(1);
  });

  test('keeps Cursor hooks setup non-destructive for existing hooks entries', async () => {
    const cursorDir = join(tempHome, '.cursor');
    const hooksPath = join(cursorDir, 'hooks.json');

    mkdirSync(cursorDir, { recursive: true });
    writeFileSync(
      hooksPath,
      JSON.stringify(
        {
          sessionStart: [{ command: '/custom/start.sh' }],
          customEvent: [{ command: '/custom/other.sh' }],
        },
        null,
        2
      )
    );

    await runSetup('cursor');

    const hooks = JSON.parse(readFileSync(hooksPath, 'utf-8')) as Record<string, any>;
    expect(hooks.customEvent).toEqual([{ command: '/custom/other.sh' }]);
    expect(
      (hooks.sessionStart as Array<Record<string, any>>).some(
        entry => entry.command === '/custom/start.sh'
      )
    ).toBe(true);
  });

  test('deduplicates dirty Cursor managed hook entries across reruns', async () => {
    const cursorDir = join(tempHome, '.cursor');
    const hooksPath = join(cursorDir, 'hooks.json');
    const hookScriptPath = join(cursorDir, 'hooks', 'mind-session-continuity.sh');

    mkdirSync(cursorDir, { recursive: true });
    writeFileSync(
      hooksPath,
      JSON.stringify(
        {
          sessionStart: [
            { command: hookScriptPath, args: ['sessionStart'] },
            { command: hookScriptPath, args: ['sessionStart'] },
          ],
          preCompact: [{ command: hookScriptPath, args: ['preCompact'] }],
          stop: [
            { command: hookScriptPath, args: ['stop'] },
            { command: hookScriptPath, args: ['stop'] },
          ],
        },
        null,
        2
      )
    );

    await runSetup('cursor');
    await runSetup('cursor');

    const hooks = JSON.parse(readFileSync(hooksPath, 'utf-8')) as Record<string, any>;
    expect(
      (hooks.sessionStart as Array<Record<string, any>>).filter(
        entry => entry.command === hookScriptPath && entry.args?.[0] === 'sessionStart'
      ).length
    ).toBe(1);
    expect(
      (hooks.preCompact as Array<Record<string, any>>).filter(
        entry => entry.command === hookScriptPath && entry.args?.[0] === 'preCompact'
      ).length
    ).toBe(1);
    expect(
      (hooks.stop as Array<Record<string, any>>).filter(
        entry => entry.command === hookScriptPath && entry.args?.[0] === 'stop'
      ).length
    ).toBe(1);
  });

  test('keeps Windsurf L1 setup behavior while leaving L2/L3 unsupported', async () => {
    await runSetup('windsurf');

    const configPath = join(tempHome, '.windsurf', 'mcp.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, any>;
    expect(config.mcpServers.mind.url).toBe('http://localhost:7438/mcp');

    const capabilities = getAgentCapabilities('windsurf');
    expect(capabilities.L2_INSTRUCTIONS.status).toBe('unsupported');
    expect(capabilities.L3_HOOKS.status).toBe('unsupported');
  });

  test('prints explicit fallback diagnostics for Gemini unsupported L2/L3', async () => {
    const logSpy = spyOn(console, 'log');

    await runSetup('gemini-cli');

    const lines = logSpy.mock.calls.map(call => String(call[0]));
    expect(
      lines.some(
        line =>
          line.includes('L2 instruction/protocol injection') &&
          line.includes('unsupported') &&
          line.includes('fallback:')
      )
    ).toBe(true);
    expect(
      lines.some(
        line =>
          line.includes('L3 hooks/session/compaction automation') &&
          line.includes('unsupported') &&
          line.includes('fallback:')
      )
    ).toBe(true);
  });

  test('configures Codex with local stdio MCP command transport', async () => {
    await runSetup('codex');

    const configPath = join(tempHome, '.codex', 'config.toml');
    const configToml = readFileSync(configPath, 'utf-8');

    expect(configToml).toContain('[mcp_servers.mind]');
    expect(configToml).toContain('args = ["mcp"]');
    expect(configToml).not.toContain('--http');
  });

  test('injects managed Codex protocol instructions into global AGENTS.md non-destructively and idempotently', async () => {
    const codexDir = join(tempHome, '.codex');
    const agentsPath = join(codexDir, 'AGENTS.md');

    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      agentsPath,
      [
        '# Existing Codex Instructions',
        '',
        'Keep this custom section.',
        '',
        '## Footer notes',
      ].join('\n')
    );

    await runSetup('codex');
    await runSetup('codex');

    const agentsMd = readFileSync(agentsPath, 'utf-8');
    expect(agentsMd).toContain('# Existing Codex Instructions');
    expect(agentsMd).toContain('## Footer notes');
    expect(agentsMd).toContain('mind managed protocol start');
    expect(agentsMd).toContain('mind managed protocol end');
    expect(agentsMd).toContain('system_instructions');
    expect(agentsMd).toContain(renderMemoryProtocol('codex').trim());

    const startCount = agentsMd.split('<!-- mind managed protocol start -->').length - 1;
    const endCount = agentsMd.split('<!-- mind managed protocol end -->').length - 1;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });

  test('repairs dirty Codex managed protocol blocks and removes legacy protocol files', async () => {
    const codexDir = join(tempHome, '.codex');
    const agentsPath = join(codexDir, 'AGENTS.md');
    const legacyProtocolPath = join(codexDir, 'mind-memory-protocol-codex.md');

    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      agentsPath,
      [
        '# Codex Notes',
        '',
        '<!-- mind managed protocol start -->',
        'stale 1',
        '<!-- mind managed protocol end -->',
        '',
        '<!-- mind managed protocol start -->',
        'stale 2',
        '<!-- mind managed protocol end -->',
      ].join('\n')
    );
    writeFileSync(legacyProtocolPath, '# stale codex protocol');

    await runSetup('codex');
    await runSetup('codex');

    const agentsMd = readFileSync(agentsPath, 'utf-8');
    expect(agentsMd.split('<!-- mind managed protocol start -->').length - 1).toBe(1);
    expect(agentsMd.split('<!-- mind managed protocol end -->').length - 1).toBe(1);
    expect(existsSync(legacyProtocolPath)).toBe(false);
  });

  test('injects managed Claude protocol instructions into global CLAUDE.md', async () => {
    await runSetup('claude-code');

    const claudeMdPath = join(tempHome, '.claude', 'CLAUDE.md');
    const claudeMd = readFileSync(claudeMdPath, 'utf-8');

    expect(claudeMd).toContain('mind managed protocol start');
    expect(claudeMd).toContain('system_instructions');
    expect(claudeMd).toContain(renderMemoryProtocol('claude-code').trim());
  });

  test('keeps Claude L3 hooks opt-in by default', async () => {
    await runSetup('claude-code');

    const configPath = join(tempHome, '.claude', 'settings.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, any>;

    expect(config.mcpServers.mind.url).toBe('http://localhost:7438/mcp');
    expect(config.hooks).toBeUndefined();
  });

  test('keeps Claude setup non-destructive and managed block idempotent across runs', async () => {
    const claudeDir = join(tempHome, '.claude');
    const settingsPath = join(claudeDir, 'settings.json');
    const claudeMdPath = join(claudeDir, 'CLAUDE.md');

    const existingConfig = {
      theme: 'dark',
      mcpServers: {
        github: { url: 'http://localhost:9999/mcp' },
      },
    };

    const existingClaudeMd = [
      '# Custom Intro',
      '',
      'Keep this section untouched.',
      '',
      '<!-- mind managed protocol start -->',
      'outdated managed content',
      '<!-- mind managed protocol end -->',
      '',
      '## Footer',
    ].join('\n');

    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(existingConfig, null, 2));
    writeFileSync(claudeMdPath, existingClaudeMd);

    await runSetup('claude-code');
    await runSetup('claude-code');

    const mergedConfig = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, any>;
    expect(mergedConfig.theme).toBe('dark');
    expect(mergedConfig.mcpServers.github.url).toBe('http://localhost:9999/mcp');
    expect(mergedConfig.mcpServers.mind.url).toBe('http://localhost:7438/mcp');

    const claudeMd = readFileSync(claudeMdPath, 'utf-8');
    expect(claudeMd).toContain('# Custom Intro');
    expect(claudeMd).toContain('## Footer');

    const managedStartCount = claudeMd.split('<!-- mind managed protocol start -->').length - 1;
    const managedEndCount = claudeMd.split('<!-- mind managed protocol end -->').length - 1;
    expect(managedStartCount).toBe(1);
    expect(managedEndCount).toBe(1);
  });

  test('repairs dirty Claude managed blocks and removes legacy protocol files', async () => {
    const claudeDir = join(tempHome, '.claude');
    const claudeMdPath = join(claudeDir, 'CLAUDE.md');
    const legacyProtocolPath = join(claudeDir, 'instructions', 'mind-memory-protocol-claude.md');

    mkdirSync(join(claudeDir, 'instructions'), { recursive: true });
    writeFileSync(
      claudeMdPath,
      [
        '# Claude Notes',
        '',
        '<!-- mind managed protocol start -->',
        'old-1',
        '<!-- mind managed protocol end -->',
        '',
        '<!-- mind managed protocol start -->',
        'old-2',
        '<!-- mind managed protocol end -->',
      ].join('\n')
    );
    writeFileSync(legacyProtocolPath, '# stale claude protocol');

    await runSetup('claude-code');
    await runSetup('claude-code');

    const claudeMd = readFileSync(claudeMdPath, 'utf-8');
    expect(claudeMd.split('<!-- mind managed protocol start -->').length - 1).toBe(1);
    expect(claudeMd.split('<!-- mind managed protocol end -->').length - 1).toBe(1);
    expect(existsSync(legacyProtocolPath)).toBe(false);
  });

  test('keeps Claude hook wiring stable and idempotent when opt-in is enabled', async () => {
    process.env.MIND_SETUP_CLAUDE_ENABLE_HOOKS = 'true';
    await runSetup('claude-code');
    await runSetup('claude-code');

    const settingsPath = join(tempHome, '.claude', 'settings.json');
    const config = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, any>;
    const stopHooks = config.hooks?.Stop as Array<Record<string, any>>;
    expect(Array.isArray(stopHooks)).toBe(true);

    const hookPath = join(tempHome, '.claude', 'hooks', 'mind-session-summary.sh');
    const managedEntries = stopHooks.filter(entry =>
      Array.isArray(entry?.hooks)
        ? entry.hooks.some((hook: Record<string, any>) => hook.command === hookPath)
        : false
    );
    expect(managedEntries.length).toBe(1);

    const hookScript = readFileSync(hookPath, 'utf-8');
    expect(hookScript).toContain('mind checkpoint set');
    expect(hookScript).toContain('|| true');
  });

  test('deduplicates dirty Claude hook entries when opt-in is enabled', async () => {
    process.env.MIND_SETUP_CLAUDE_ENABLE_HOOKS = 'true';
    const claudeDir = join(tempHome, '.claude');
    const settingsPath = join(claudeDir, 'settings.json');
    const hookPath = join(tempHome, '.claude', 'hooks', 'mind-session-summary.sh');

    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                matcher: 'session.stop',
                hooks: [
                  { type: 'command', command: hookPath },
                  { type: 'command', command: hookPath },
                ],
              },
              {
                matcher: 'session.stop',
                hooks: [{ type: 'command', command: hookPath }],
              },
            ],
          },
        },
        null,
        2
      )
    );

    await runSetup('claude-code');
    await runSetup('claude-code');

    const config = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, any>;
    const stopHooks = config.hooks?.Stop as Array<Record<string, any>>;
    const managedEntries = stopHooks.filter(entry =>
      Array.isArray(entry?.hooks)
        ? entry.hooks.some((hook: Record<string, any>) => hook.command === hookPath)
        : false
    );

    expect(managedEntries.length).toBe(1);
  });
});
