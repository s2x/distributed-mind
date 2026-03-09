# Mind Memory Protocol (Codex)

Use this protocol when Codex is connected to the `mind` MCP server.

## Core Rules

- Call `mind_system_instructions` before using memory tools in a new session.
- Use repo-based project spaces (example: `projects/mind`).
- Persist important context immediately (decisions, bug fixes, discoveries, config updates).
- Keep tags consistent (`cat:decision`, `cat:bugfix`, `cat:discovery`, `type:project`).

## Session Continuity

- Keep the active checkpoint fresh with `checkpoint_set`.
- Mark completed work with `checkpoint_complete`.
- During recovery, use `checkpoint_recover` before taking new actions.

## Post-Compaction Checklist

If context resets or compaction happens:

1. Call `checkpoint_recover` for the active project.
2. Query recent context with `memory_query` and/or `search`.
3. Re-establish goal, pending steps, and relevant files before making edits.

## Minimal Workflow

1. Ensure project space exists (`space_get` or `space_create`).
2. Save major findings with `memory_add`.
3. Keep `checkpoint_set` updated while implementing.
4. End with a concise session summary memory in `sessions/<repo>`.
