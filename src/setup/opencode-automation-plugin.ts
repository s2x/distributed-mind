// Extracted from setup.ts - OpenCode prudent automation plugin builder
// This is the embedded JavaScript string for OpenCode's experimental plugin system

export function buildOpenCodeAutomationPlugin(mindPath: string): string {
  const resolvedMindPath = JSON.stringify(mindPath);

  // Static reminder for new/post-compacted sessions (~200 chars, action-oriented)
  const RECOVERY_TEXT =
    'Prudent session detected. Call `checkpoint_load` to restore recent work and maintain continuity.';

  return `import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const MIND_BIN = ${resolvedMindPath};
const FALLBACK_MIND_BIN = ${JSON.stringify(mindPath.includes('dimind') ? 'dimind' : 'mind')};
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
  const normalized = String(value ?? '').replace(/[ \\t\\n\\r]+/g, ' ').trim();
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
  return import.meta.dir + '/.' + FALLBACK_MIND_BIN + '-automation-state.json';
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
            escaped ? '\\nRecovered context snapshot:\\n' + escaped : '\\nRecovered context snapshot unavailable; follow manual mind protocol.'
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
