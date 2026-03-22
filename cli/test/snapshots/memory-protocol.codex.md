# Mind Memory Protocol (Codex)

Use this protocol when Codex is connected to the `mind` MCP server.

## Core Rules

- Call `mind_system_instructions` before using memory tools in a new session.
- Use repo-based project spaces (example: `projects/mind`).
- Persist important context immediately (decisions, bug fixes, discoveries, config updates).
- Keep tags consistent (`cat:decision`, `cat:bugfix`, `cat:discovery`, `type:project`).
- Link related memories so future agents can trace connections: pass `links_to_ids` when adding a memory that depends on or extends another, or use `link_create` for labeled relationships between existing memories. Get IDs from `memory_query` or `search`.
- Composite operations (`memory_add` with links) are atomic all-or-nothing.

## Session Continuity

- Keep the active checkpoint fresh with `checkpoint_save`.
- Mark completed work with `checkpoint_done`.
- During recovery, use `checkpoint_load` before taking new actions.

## Post-Compaction Checklist

If context resets or compaction happens:

1. Call `checkpoint_load` for the active project.
2. Query recent context with `memory_query` and/or `search`.
3. Re-establish goal, pending steps, and relevant files before making edits.

## Minimal Workflow

1. Ensure project space exists (`space_get` or `space_create`).
2. Save major findings with `memory_add` (always include tags and `links_to_ids` when related memories exist).
3. Keep `checkpoint_save` updated while implementing.
4. End with a concise session summary memory in `sessions/<repo>`.
