import { spawn } from 'child_process';
import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';

import { DEFAULT_PORT } from '../config';

import {
  type CapabilityMap,
  type SupportedAgent,
  formatCapabilityLine,
  getAgentCapabilities,
  getAgentCapabilityMatrix,
  getSupportedAgentDefinition,
} from './capabilities';
import { renderMemoryProtocol } from './memory-protocol';
export { getAgentCapabilities, getAgentCapabilityMatrix } from './capabilities';

interface AgentConfig {
  name: string;
  configPath: string;
  format: 'json' | 'toml';
  build: (_mcpUrl: string, _mindPath: string) => string | Record<string, unknown>;
  capabilities: CapabilityMap;
}

const DEFAULT_MCP_PORT = 7438;

const OPENCODE_MEMORY_PROTOCOL_FILENAME = 'mind-memory-protocol.md';

const OPENCODE_AUTOMATION_PLUGIN_FILENAME = 'mind-automation.js';

const CLAUDE_MEMORY_PROTOCOL_FILENAME = 'mind-memory-protocol.md';

const CLAUDE_MANAGED_BLOCK_START = '<!-- mind managed protocol start -->';
const CLAUDE_MANAGED_BLOCK_END = '<!-- mind managed protocol end -->';

const CLAUDE_HOOK_SCRIPT_NAME = 'mind-session-summary.sh';
const CLAUDE_HOOKS_OPT_IN_ENV = 'MIND_SETUP_CLAUDE_ENABLE_HOOKS';

const CURSOR_HOOK_SCRIPT_NAME = 'mind-session-continuity.sh';
const CURSOR_HOOK_EVENTS = ['sessionStart', 'preCompact', 'stop'] as const;

const LEGACY_PROTOCOL_FILENAMES = [
  'mind-memory-protocol-opencode.md',
  'mind-memory-protocol-claude.md',
  'mind-memory-protocol-claude-code.md',
  'mind-memory-protocol-codex.md',
  'mind-memory-protocol.claude.md',
  'mind-memory-protocol.codex.md',
];

function getHomeDir(): string {
  return process.env.HOME ?? homedir();
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getMindScriptPath(): string {
  const script = path.resolve(__dirname, '..', '..', '..', 'mind');
  if (fs.existsSync(script)) {
    return script;
  }
  return 'mind';
}

function getMindEntryPath(): string {
  return path.resolve(__dirname, '..', 'mind.ts');
}

function getPidDir(): string {
  return path.join(homedir(), '.mind');
}

function getPidPath(name: 'mcp' | 'serve'): string {
  return path.join(getPidDir(), `${name}.pid`);
}

function writePid(name: 'mcp' | 'serve', pid: number): void {
  ensureDir(getPidDir());
  fs.writeFileSync(getPidPath(name), String(pid));
}

function readPid(name: 'mcp' | 'serve'): number | null {
  const pidPath = getPidPath(name);
  if (!fs.existsSync(pidPath)) return null;
  const pid = Number(fs.readFileSync(pidPath, 'utf-8').trim());
  return Number.isFinite(pid) ? pid : null;
}

function clearPid(name: 'mcp' | 'serve'): void {
  const pidPath = getPidPath(name);
  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJson(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(filePath: string, value: Record<string, unknown>): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readText(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
}

function writeText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const existing = out[k];
    if (
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      v &&
      typeof v === 'object' &&
      !Array.isArray(v)
    ) {
      out[k] = deepMerge(existing as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function ensureOpenCodeInstructionPath(): string {
  const instructionsDir = path.join(getHomeDir(), '.config', 'opencode', 'instructions');
  const instructionPath = path.join(instructionsDir, OPENCODE_MEMORY_PROTOCOL_FILENAME);
  ensureDir(instructionsDir);
  removeLegacyProtocolFiles(instructionsDir);
  writeText(instructionPath, renderMemoryProtocol('opencode'));
  return instructionPath;
}

function isLegacyProtocolPath(entry: unknown): boolean {
  if (typeof entry !== 'string') {
    return false;
  }

  return LEGACY_PROTOCOL_FILENAMES.includes(path.basename(entry));
}

function dedupeStringEntries(values: unknown[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    if (!seen.has(value)) {
      deduped.push(value);
      seen.add(value);
    }
  }

  return deduped;
}

function removeLegacyProtocolFiles(baseDir: string): void {
  for (const filename of LEGACY_PROTOCOL_FILENAMES) {
    const candidate = path.join(baseDir, filename);
    if (fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
    }
  }
}

function placeInstructionFirst(
  config: Record<string, unknown>,
  instructionPath: string
): Record<string, unknown> {
  const existingInstructions = Array.isArray(config.instructions) ? config.instructions : [];
  const sanitized = dedupeStringEntries(existingInstructions).filter(
    entry => entry !== instructionPath && !isLegacyProtocolPath(entry)
  );
  return {
    ...config,
    instructions: [instructionPath, ...sanitized],
  };
}

function buildOpenCodeAutomationPlugin(mindPath: string): string {
  const resolvedMindPath = JSON.stringify(mindPath);

  // Static reminder for new/post-compacted sessions (~200 chars, action-oriented)
  const RECOVERY_TEXT =
    'Prudent session detected. Call `checkpoint_load` to restore recent work and maintain continuity.';

  return `import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const MIND_BIN = ${resolvedMindPath};
const FALLBACK_MIND_BIN = 'mind';
const STATE_VERSION = 1;
const MAX_STATE_KEYS = 400;
const MAX_CONTEXT_CHARS = 1600;
const MAX_NOTES_CHARS = 800;
const MIN_CHECKPOINT_INTERVAL_MS = 90_000;
const MIN_SUMMARY_INTERVAL_MS = 240_000;
const RECOVERY_TEXT = ${JSON.stringify(RECOVERY_TEXT)};

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function clampText(value, maxChars) {
  const normalized = String(value ?? '').replace(/[ \\\\t\\\\n\\\\r]+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
}

function sanitizeSegment(value) {
  const text = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || 'unknown';
}

function extractSessionId(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'session-unknown';
  }

  const direct = payload.sessionId ?? payload.id;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct;
  }

  const nested = payload.session;
  if (nested && typeof nested === 'object') {
    const nestedId = nested.id ?? nested.sessionId;
    if (typeof nestedId === 'string' && nestedId.trim().length > 0) {
      return nestedId;
    }
  }

  return 'session-unknown';
}

function buildProjectName(ctx) {
  const fromWorktree = typeof ctx?.worktree === 'string' ? basename(ctx.worktree) : '';
  const fromDirectory = typeof ctx?.directory === 'string' ? basename(ctx.directory) : '';
  return sanitizeSegment(fromWorktree || fromDirectory || 'unknown');
}

function getProjectSpace(ctx) {
  return 'projects/' + buildProjectName(ctx);
}

function getSessionSpace(ctx) {
  return 'sessions/' + buildProjectName(ctx);
}

function getStatePath() {
  return import.meta.dir + '/.mind-automation-state.json';
}

function loadState() {
  const filePath = getStatePath();
  if (!existsSync(filePath)) {
    return { version: STATE_VERSION, checkpoints: {}, summaries: {}, handled: {} };
  }

  const parsed = safeJsonParse(readFileSync(filePath, 'utf-8'), null);
  if (!parsed || typeof parsed !== 'object') {
    return { version: STATE_VERSION, checkpoints: {}, summaries: {}, handled: {} };
  }

  return {
    version: STATE_VERSION,
    checkpoints: typeof parsed.checkpoints === 'object' && parsed.checkpoints ? parsed.checkpoints : {},
    summaries: typeof parsed.summaries === 'object' && parsed.summaries ? parsed.summaries : {},
    handled: typeof parsed.handled === 'object' && parsed.handled ? parsed.handled : {},
  };
}

function compactHandledKeys(handled) {
  const keys = Object.keys(handled);
  if (keys.length <= MAX_STATE_KEYS) {
    return handled;
  }

  const sorted = keys
    .map((key) => ({ key, value: Number(handled[key]) || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_STATE_KEYS);

  const next = {};
  for (const item of sorted) {
    next[item.key] = item.value;
  }
  return next;
}

function saveState(state) {
  try {
    const filePath = getStatePath();
    mkdirSync(import.meta.dir, { recursive: true });
    const safeState = {
      ...state,
      version: STATE_VERSION,
      handled: compactHandledKeys(state.handled ?? {}),
    };
    writeFileSync(filePath, JSON.stringify(safeState, null, 2));
  } catch {
    // Non-blocking fallback: manual protocol remains available.
  }
}

function hasIntervalPassed(lastByKey, key, minMs) {
  const now = Date.now();
  const previous = Number(lastByKey[key] ?? 0);
  if (Number.isFinite(previous) && previous > 0 && now - previous < minMs) {
    return false;
  }

  lastByKey[key] = now;
  return true;
}

function runMindCommand(args) {
  const baseOptions = { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] };
  let result = spawnSync(MIND_BIN, args, baseOptions);
  if (result.status === 0) {
    return { ok: true, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
  }

  result = spawnSync(FALLBACK_MIND_BIN, args, baseOptions);
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

function ensureSessionScaffold(space, checkpointNotes) {
  runMindCommand(['create', space, 'Managed by OpenCode prudent automation']);
  runMindCommand([
    'checkpoint',
    'set',
    space,
    'Active OpenCode session',
    'Keep the current goal, pending work, and next action explicit',
    '--notes',
    checkpointNotes,
  ]);
}

function buildEventNotes(ctx, payload, extra) {
  const repo = buildProjectName(ctx);
  const sessionId = extractSessionId(payload);
  const sections = [
    'repo=' + repo,
    'session=' + sessionId,
    'event=' + String(payload?.type ?? 'unknown'),
    extra,
    'updated=' + nowIso(),
  ].filter(Boolean);

  return clampText(sections.join(' | '), MAX_NOTES_CHARS);
}

function recoverCheckpointContext(projectSpace) {
  const recovered = runMindCommand(['checkpoint', 'recover', projectSpace, '--history']);
  if (!recovered.ok) {
    return null;
  }

  const text = clampText(recovered.stdout, MAX_CONTEXT_CHARS);
  return text.length > 0 ? text : null;
}

function persistSessionSummary(ctx, payload, summary, state) {
  const sessionSpace = getSessionSpace(ctx);
  const sessionId = extractSessionId(payload);
  const dedupeKey = sessionSpace + ':' + sessionId;
  if (!hasIntervalPassed(state.summaries, dedupeKey, MIN_SUMMARY_INTERVAL_MS)) {
    return;
  }

  const safeSummary = clampText(summary, MAX_NOTES_CHARS);
  if (!safeSummary) {
    return;
  }

  runMindCommand(['create', sessionSpace, 'Session summaries managed by OpenCode prudent automation']);

  const memoryName = 'summary-' + sanitizeSegment(sessionId) + '-' + Date.now();
  runMindCommand([
    'add',
    sessionSpace,
    memoryName,
    safeSummary,
    '--tags',
    'type:session,cat:discovery',
  ]);
}

export const MindAutomationPlugin = async (ctx) => {
  const state = loadState();

  const checkpointForEvent = (eventPayload, extra) => {
    const projectSpace = getProjectSpace(ctx);
    const checkpointKey = projectSpace + ':' + extractSessionId(eventPayload);
    if (!hasIntervalPassed(state.checkpoints, checkpointKey, MIN_CHECKPOINT_INTERVAL_MS)) {
      return;
    }

    const notes = buildEventNotes(ctx, eventPayload, extra);
    ensureSessionScaffold(projectSpace, notes);
  };

  return {
    event: async ({ event }) => {
      try {
        if (!event || typeof event !== 'object') {
          return;
        }

        if (event.type === 'session.created') {
          checkpointForEvent(event, 'Ensure project space and checkpoint at session start');
          return;
        }

        if (event.type === 'session.compacted') {
          checkpointForEvent(event, 'Post-compaction checkpoint refresh and context recovery');
          recoverCheckpointContext(getProjectSpace(ctx));
          return;
        }

        if (event.type === 'session.deleted' || event.type === 'session.idle') {
          const summary = buildEventNotes(ctx, event, 'Session end summary (prudent)');
          persistSessionSummary(ctx, event, summary, state);
        }
      } catch {
        // Non-blocking fallback: protocol instructions remain available.
      } finally {
        saveState(state);
      }
    },

    'experimental.session.compacting': async (input, output) => {
      try {
        const payload = input && typeof input === 'object' ? input : {};
        const eventKey = getProjectSpace(ctx) + ':compacting:' + extractSessionId(payload);
        if (!hasIntervalPassed(state.handled, eventKey, MIN_CHECKPOINT_INTERVAL_MS)) {
          return;
        }

        checkpointForEvent(payload, 'Pre-compaction checkpoint capture and signal preservation');
        const recovered = recoverCheckpointContext(getProjectSpace(ctx));
        const escaped = (recovered ?? '').replace(/\\n/g, '\\n');

        if (Array.isArray(output?.context)) {
          output.context.push(
            '## mind Prudent Continuity',
            '- Before compaction: key context was checkpointed using mind checkpoint set.',
            '- After compaction: recover with \`checkpoint recover <project-space> --history\` if needed.',
            escaped ? '\\\\nRecovered context snapshot:\\\\n' + escaped : '\\\\nRecovered context snapshot unavailable; follow manual mind protocol.'
          );
        }
      } catch {
        // Non-blocking fallback: protocol instructions remain available.
      } finally {
        saveState(state);
      }
    },

    'experimental.chat.system.transform': async (input, output) => {
      try {
        if (!Array.isArray(output?.system) || output.system.length === 0) {
          return;
        }

        const sessionId = input && typeof input === 'object' ? extractSessionId(input) : 'session-unknown';
        const dedupeKey = getProjectSpace(ctx) + ':chat-transform:' + sessionId;

        if (state.handled[dedupeKey]) {
          return;
        }

        const lastIdx = output.system.length - 1;
        const projectSpace = getProjectSpace(ctx);
        const recovered = recoverCheckpointContext(projectSpace);
        const escaped = (recovered ?? '').replace(/\\n/g, '\\n');

        if (escaped) {
          state.handled[dedupeKey] = Date.now();
          output.system[lastIdx] += '\\n\\n' + escaped;
        } else {
          state.handled[dedupeKey] = Date.now();
          output.system[lastIdx] += '\\n\\n' + RECOVERY_TEXT;
        }
      } catch {
        // Non-blocking fallback: protocol instructions remain available.
      } finally {
        saveState(state);
      }
    },
  };
};
`;
}

function ensureOpenCodeAutomationPlugin(mindPath: string): string {
  const pluginsDir = path.join(getHomeDir(), '.config', 'opencode', 'plugins');
  const pluginPath = path.join(pluginsDir, OPENCODE_AUTOMATION_PLUGIN_FILENAME);
  ensureDir(pluginsDir);
  writeText(pluginPath, buildOpenCodeAutomationPlugin(mindPath));
  return pluginPath;
}

function ensureClaudeInstructionPath(): string {
  const instructionsDir = path.join(getHomeDir(), '.claude', 'instructions');
  const instructionPath = path.join(instructionsDir, CLAUDE_MEMORY_PROTOCOL_FILENAME);
  ensureDir(instructionsDir);
  removeLegacyProtocolFiles(instructionsDir);
  writeText(instructionPath, renderMemoryProtocol('claude-code'));
  return instructionPath;
}

function upsertManagedBlock(content: string, block: string): string {
  const escapedStart = CLAUDE_MANAGED_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = CLAUDE_MANAGED_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'g');
  const stripped = content
    .replace(pattern, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  if (stripped.length === 0) {
    return `${block}\n`;
  }

  return `${stripped}\n\n${block}\n`;
}

function ensureClaudeManagedInstructions(instructionPath: string): void {
  const claudeDir = path.join(getHomeDir(), '.claude');
  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');

  ensureDir(claudeDir);
  const current = readText(claudeMdPath);

  const managedBody = [
    CLAUDE_MANAGED_BLOCK_START,
    '## mind Memory Protocol (managed)',
    '',
    `Source: ${instructionPath}`,
    '',
    renderMemoryProtocol('claude-code').trim(),
    CLAUDE_MANAGED_BLOCK_END,
  ].join('\n');

  const next = upsertManagedBlock(current, managedBody);
  writeText(claudeMdPath, next);
}

function ensureCodexManagedInstructions(): void {
  const codexDir = path.join(getHomeDir(), '.codex');
  const agentsPath = path.join(codexDir, 'AGENTS.md');

  ensureDir(codexDir);
  removeLegacyProtocolFiles(codexDir);
  const current = readText(agentsPath);

  const managedBody = [
    CLAUDE_MANAGED_BLOCK_START,
    '## mind Memory Protocol (managed)',
    '',
    renderMemoryProtocol('codex').trim(),
    CLAUDE_MANAGED_BLOCK_END,
  ].join('\n');

  const next = upsertManagedBlock(current, managedBody);
  writeText(agentsPath, next);
}

function shouldEnableClaudeHooks(): boolean {
  const value = (process.env[CLAUDE_HOOKS_OPT_IN_ENV] ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function ensureExecutableScript(filePath: string, content: string): string {
  writeText(filePath, content);
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

function ensureClaudeHookScript(): string {
  const hooksDir = path.join(getHomeDir(), '.claude', 'hooks');
  ensureDir(hooksDir);

  const scriptPath = path.join(hooksDir, CLAUDE_HOOK_SCRIPT_NAME);
  const script = `#!/usr/bin/env bash
set -euo pipefail

if ! command -v mind >/dev/null 2>&1; then
  exit 0
fi

PROJECT_SPACE="\${MIND_PROJECT_SPACE:-projects/unknown}"
SUMMARY="\${CLAUDE_SESSION_SUMMARY:-Claude session closed. Capture summary via checkpoint and memory tools.}"

mind checkpoint set "$PROJECT_SPACE" "Session close" "Review summary and persist key learnings" --notes "$SUMMARY" >/dev/null 2>&1 || true
`;

  return ensureExecutableScript(scriptPath, script);
}

function ensureCursorHookScript(): string {
  const hooksDir = path.join(getHomeDir(), '.cursor', 'hooks');
  ensureDir(hooksDir);

  const scriptPath = path.join(hooksDir, CURSOR_HOOK_SCRIPT_NAME);
  const script = `#!/usr/bin/env bash
set -euo pipefail

if ! command -v mind >/dev/null 2>&1; then
  exit 0
fi

EVENT="\${1:-\${CURSOR_HOOK_EVENT:-unknown}}"
PROJECT_SPACE="\${MIND_PROJECT_SPACE:-projects/unknown}"

case "$EVENT" in
  sessionStart)
    mind checkpoint set "$PROJECT_SPACE" "Cursor session start" "Capture active goal and pending work" --notes "cursor:event=sessionStart" >/dev/null 2>&1 || true
    ;;
  preCompact)
    mind checkpoint set "$PROJECT_SPACE" "Cursor pre-compact" "Snapshot context before compaction" --notes "cursor:event=preCompact" >/dev/null 2>&1 || true
    mind checkpoint recover "$PROJECT_SPACE" --history >/dev/null 2>&1 || true
    ;;
  stop)
    mind checkpoint set "$PROJECT_SPACE" "Cursor session stop" "Persist final continuity notes" --notes "cursor:event=stop" >/dev/null 2>&1 || true
    ;;
  *)
    exit 0
    ;;
esac
`;

  return ensureExecutableScript(scriptPath, script);
}

function withCursorHooksConfig(
  config: Record<string, unknown>,
  hookScriptPath: string
): Record<string, unknown> {
  const next = { ...config };

  for (const eventName of CURSOR_HOOK_EVENTS) {
    const existing = Array.isArray(next[eventName]) ? (next[eventName] as Array<unknown>) : [];

    const isManagedEntry = (entry: unknown): boolean => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }

      const candidate = entry as { command?: string; args?: unknown };
      return (
        candidate.command === hookScriptPath &&
        Array.isArray(candidate.args) &&
        candidate.args.length === 1 &&
        candidate.args[0] === eventName
      );
    };

    const managedEntry = {
      command: hookScriptPath,
      args: [eventName],
    };

    const withoutManaged = existing.filter(entry => !isManagedEntry(entry));

    next[eventName] = [...withoutManaged, managedEntry];
  }

  return next;
}

function ensureCursorHooksSetup(): void {
  const cursorDir = path.join(getHomeDir(), '.cursor');
  const hooksPath = path.join(cursorDir, 'hooks.json');

  ensureDir(cursorDir);

  const hookScriptPath = ensureCursorHookScript();
  const currentHooks = readJson(hooksPath);
  const mergedHooks = withCursorHooksConfig(currentHooks, hookScriptPath);

  writeJson(hooksPath, mergedHooks);
  console.log(`- Cursor global hooks configured: ${hooksPath}`);
}

function withClaudeHooksConfig(
  config: Record<string, unknown>,
  hookScriptPath: string
): Record<string, unknown> {
  const hookEntry = {
    matcher: 'session.stop',
    hooks: [
      {
        type: 'command',
        command: hookScriptPath,
      },
    ],
  };

  const hooksRoot =
    config.hooks && typeof config.hooks === 'object' && !Array.isArray(config.hooks)
      ? (config.hooks as Record<string, unknown>)
      : {};

  const stopHooks = Array.isArray(hooksRoot.Stop) ? hooksRoot.Stop : [];
  const nextStopHooks = stopHooks
    .map(entry => {
      if (!entry || typeof entry !== 'object') {
        return entry;
      }

      const candidate = entry as { hooks?: Array<{ command?: string }> };
      if (!Array.isArray(candidate.hooks)) {
        return entry;
      }

      const sanitizedHooks = candidate.hooks.filter(hook => hook?.command !== hookScriptPath);
      if (sanitizedHooks.length === 0) {
        return null;
      }

      return {
        ...entry,
        hooks: sanitizedHooks,
      };
    })
    .filter(entry => entry !== null);

  nextStopHooks.push(hookEntry);

  return {
    ...config,
    hooks: {
      ...hooksRoot,
      Stop: nextStopHooks,
    },
  };
}

function getMcpPort(): number {
  return Number(process.env.MCP_PORT ?? DEFAULT_MCP_PORT);
}

function getWebPort(): number {
  return Number(process.env.MIND_PORT ?? DEFAULT_PORT);
}

export async function startMcpDetached(): Promise<void> {
  const existingPid = readPid('mcp');
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(`MCP server already running (pid: ${existingPid})`);
    return;
  }

  const bunPath = process.execPath;
  const mindEntry = getMindEntryPath();
  const port = String(getMcpPort());
  const child = spawn(bunPath, ['run', mindEntry, 'mcp', 'start', '--http', '--port', port], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  if (!child.pid) {
    console.log('Failed to start MCP server');
    return;
  }

  await new Promise(resolve => setTimeout(resolve, 500));
  if (!isProcessRunning(child.pid)) {
    console.log(
      'Failed to start MCP server (process exited immediately). Check port availability.'
    );
    return;
  }

  writePid('mcp', child.pid);
  console.log(`✅ MCP server started (pid: ${child.pid}) on http://localhost:${port}/mcp`);
}

export async function stopMcp(): Promise<void> {
  const pid = readPid('mcp');
  if (!pid) {
    console.log('MCP server not running');
    return;
  }

  if (!isProcessRunning(pid)) {
    clearPid('mcp');
    console.log('MCP server not running');
    return;
  }

  process.kill(pid, 'SIGTERM');
  clearPid('mcp');
  console.log(`✅ MCP server stopped (pid: ${pid})`);
}

export async function startServeDetached(port?: number): Promise<void> {
  const existingPid = readPid('serve');
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(`Web server already running (pid: ${existingPid})`);
    return;
  }

  const bunPath = process.execPath;
  const mindEntry = getMindEntryPath();
  const finalPort = String(port ?? getWebPort());
  const child = spawn(bunPath, ['run', mindEntry, 'serve', 'start', '--port', finalPort], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  if (!child.pid) {
    console.log('Failed to start web server');
    return;
  }

  await new Promise(resolve => setTimeout(resolve, 500));
  if (!isProcessRunning(child.pid)) {
    console.log(
      'Failed to start web server (process exited immediately). Check port availability.'
    );
    return;
  }

  writePid('serve', child.pid);
  console.log(`✅ Web server started (pid: ${child.pid}) on http://localhost:${finalPort}`);
}

export async function stopServe(): Promise<void> {
  const pid = readPid('serve');
  if (!pid) {
    console.log('Web server not running');
    return;
  }

  if (!isProcessRunning(pid)) {
    clearPid('serve');
    console.log('Web server not running');
    return;
  }

  process.kill(pid, 'SIGTERM');
  clearPid('serve');
  console.log(`✅ Web server stopped (pid: ${pid})`);
}

export async function statusServers(): Promise<void> {
  const mcpPid = readPid('mcp');
  const servePid = readPid('serve');
  const mcpStatus = mcpPid && isProcessRunning(mcpPid) ? `running (pid: ${mcpPid})` : 'stopped';
  const serveStatus =
    servePid && isProcessRunning(servePid) ? `running (pid: ${servePid})` : 'stopped';

  console.log('Mind Servers Status:');
  console.log(`  MCP:  ${mcpStatus}  -> http://localhost:${getMcpPort()}/mcp`);
  console.log(`  Web:  ${serveStatus}  -> http://localhost:${getWebPort()}`);
}

function getAgentConfig(agent: SupportedAgent): AgentConfig {
  const mcpUrl = `http://localhost:${getMcpPort()}/mcp`;

  const map: Record<SupportedAgent, Omit<AgentConfig, 'capabilities'>> = {
    'claude-code': {
      name: getSupportedAgentDefinition('claude-code').name,
      configPath: path.join(getHomeDir(), '.claude', 'settings.json'),
      format: 'json',
      build: () => ({
        mcpServers: {
          mind: {
            url: mcpUrl,
          },
        },
      }),
    },
    opencode: {
      name: getSupportedAgentDefinition('opencode').name,
      configPath: path.join(getHomeDir(), '.config', 'opencode', 'opencode.json'),
      format: 'json',
      build: (_url, mindPath) => ({
        mcp: {
          mind: {
            type: 'local',
            command: [mindPath, 'mcp'],
            enabled: true,
          },
        },
      }),
    },
    codex: {
      name: getSupportedAgentDefinition('codex').name,
      configPath: path.join(getHomeDir(), '.codex', 'config.toml'),
      format: 'toml',
      build: (_url, mindPath) => `\n[mcp_servers.mind]\ncommand = "${mindPath}"\nargs = ["mcp"]\n`,
    },
    cursor: {
      name: getSupportedAgentDefinition('cursor').name,
      configPath: path.join(getHomeDir(), '.cursor', 'mcp.json'),
      format: 'json',
      build: () => ({
        mcpServers: {
          mind: { url: mcpUrl },
        },
      }),
    },
    windsurf: {
      name: getSupportedAgentDefinition('windsurf').name,
      configPath: path.join(getHomeDir(), '.windsurf', 'mcp.json'),
      format: 'json',
      build: () => ({
        mcpServers: {
          mind: { url: mcpUrl },
        },
      }),
    },
    'gemini-cli': {
      name: getSupportedAgentDefinition('gemini-cli').name,
      configPath: path.join(getHomeDir(), '.gemini', 'settings.json'),
      format: 'json',
      build: () => ({
        mcpServers: {
          mind: { url: mcpUrl },
        },
      }),
    },
  };

  const config = map[agent];
  return { ...config, capabilities: getAgentCapabilities(agent) };
}

function printCapabilityDiagnostics(agentName: string, capabilities: CapabilityMap): void {
  console.log(`Capability diagnostics for ${agentName}:`);
  console.log(formatCapabilityLine('L1_MCP', capabilities.L1_MCP));
  console.log(formatCapabilityLine('L2_INSTRUCTIONS', capabilities.L2_INSTRUCTIONS));
  console.log(formatCapabilityLine('L3_HOOKS', capabilities.L3_HOOKS));
}

export { buildOpenCodeAutomationPlugin };
export async function runSetup(agent: SupportedAgent): Promise<void> {
  const cfg = getAgentConfig(agent);
  if (!cfg) {
    throw new Error(`Unsupported agent: ${agent}`);
  }
  const mcpUrl = `http://localhost:${getMcpPort()}/mcp`;
  const mindPath = getMindScriptPath();

  if (cfg.format === 'json') {
    const current = readJson(cfg.configPath);
    const patch = cfg.build(mcpUrl, mindPath) as Record<string, unknown>;
    let merged = deepMerge(current, patch);

    if (agent === 'opencode') {
      const instructionsPath = ensureOpenCodeInstructionPath();
      merged = placeInstructionFirst(merged, instructionsPath);

      try {
        const pluginPath = ensureOpenCodeAutomationPlugin(mindPath);
        console.log(`- OpenCode prudent automation plugin configured: ${pluginPath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`- OpenCode prudent automation plugin setup failed safely: ${message}`);
      }

      // Install mind-management skill
      try {
        const skillPath = ensureOpenCodeMindManagementSkill();
        if (skillPath) {
          console.log(`- mind-management skill available in OpenCode`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`- mind-management skill setup failed safely: ${message}`);
      }
    }

    if (agent === 'claude-code') {
      const instructionsPath = ensureClaudeInstructionPath();
      ensureClaudeManagedInstructions(instructionsPath);

      // Install mind-management skill
      try {
        const skillPath = ensureClaudeMindManagementSkill();
        if (skillPath) {
          console.log(`- mind-management skill available in Claude Code`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`- mind-management skill setup failed safely: ${message}`);
      }

      if (shouldEnableClaudeHooks()) {
        try {
          const hookScriptPath = ensureClaudeHookScript();
          merged = withClaudeHooksConfig(merged, hookScriptPath);
          console.log(`- Claude hooks opt-in enabled via ${CLAUDE_HOOKS_OPT_IN_ENV}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`- Claude hooks opt-in failed safely: ${message}`);
        }
      } else {
        console.log(`- Claude hooks remain opt-in (set ${CLAUDE_HOOKS_OPT_IN_ENV}=true to enable)`);
      }
    }

    if (agent === 'cursor') {
      try {
        ensureCursorHooksSetup();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`- Cursor hooks setup failed safely: ${message}`);
      }
    }

    writeJson(cfg.configPath, merged);
  } else {
    const current = readText(cfg.configPath);
    const snippet = cfg.build(mcpUrl, mindPath) as string;
    const merged = current.includes('[mcp_servers.mind]') ? current : `${current}${snippet}`;
    writeText(cfg.configPath, merged);

    if (agent === 'codex') {
      try {
        ensureCodexManagedInstructions();
        console.log('- Codex managed AGENTS protocol block configured');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`- Codex managed AGENTS protocol setup failed safely: ${message}`);
      }
    }
  }

  console.log(`✅ Setup complete for ${cfg.name}`);
  console.log(`- Config updated: ${cfg.configPath}`);
  console.log('- Start MCP server with: `mind mcp start --detached`');
  printCapabilityDiagnostics(cfg.name, cfg.capabilities);
}

export function listAgents(): void {
  console.log('Supported agents and Capability matrix (status/confidence/evidence/fallback):');

  for (const { agent, name, capabilities } of getAgentCapabilityMatrix()) {
    console.log(`  ${agent} (${name})`);
    console.log(`    ${formatCapabilityLine('L1_MCP', capabilities.L1_MCP)}`);
    console.log(`    ${formatCapabilityLine('L2_INSTRUCTIONS', capabilities.L2_INSTRUCTIONS)}`);
    console.log(`    ${formatCapabilityLine('L3_HOOKS', capabilities.L3_HOOKS)}`);
  }
}

// Skill management — single source file for all providers
const SKILL_MIND_MANAGEMENT_SOURCE = path.resolve(
  __dirname,
  '..',
  'resources',
  'skill-mind-management.md'
);

function ensureOpenCodeMindManagementSkill(): string | null {
  const skillFile = SKILL_MIND_MANAGEMENT_SOURCE;

  if (!fs.existsSync(skillFile)) {
    console.log(
      `- mind-management skill not found in bundle (${skillFile}), skipping skill installation`
    );
    return null;
  }

  const skillsDir = path.join(getHomeDir(), '.config', 'opencode', 'skills', 'mind-management');
  const destPath = path.join(skillsDir, 'SKILL.md');

  ensureDir(skillsDir);
  const skillContent = fs.readFileSync(skillFile, 'utf-8');
  fs.writeFileSync(destPath, skillContent);

  console.log(`- mind-management skill installed: ${destPath}`);
  return destPath;
}

function ensureClaudeMindManagementSkill(): string | null {
  const skillFile = SKILL_MIND_MANAGEMENT_SOURCE;

  if (!fs.existsSync(skillFile)) {
    console.log(
      `- mind-management skill not found in bundle (${skillFile}), skipping skill installation`
    );
    return null;
  }

  const skillsDir = path.join(getHomeDir(), '.claude', 'skills', 'mind-management');
  const destPath = path.join(skillsDir, 'SKILL.md');

  ensureDir(skillsDir);
  const skillContent = fs.readFileSync(skillFile, 'utf-8');
  fs.writeFileSync(destPath, skillContent);

  console.log(`- mind-management skill installed: ${destPath}`);
  return destPath;
}
