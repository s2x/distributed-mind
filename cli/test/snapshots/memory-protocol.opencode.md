# Mind Memory Protocol (mind)

Use this protocol whenever the `mind` MCP server is available.

## Core Rules

- Before using mind tools, call `mind_system_instructions` to learn correct usage details.
- Use repo-based project spaces (example: `projects/mind`).
- Persist important context immediately (decisions, bug fixes, discoveries, config updates).
- Keep tags consistent (`cat:decision`, `cat:bugfix`, `cat:discovery`, `type:project`).
- Link directly relevant memories for recovery continuity (`links_to_ids`, `memory_patch add_links_to_ids`, or `link_create`).
- Composite operations (`memory_add` with links, `memory_patch`) are atomic all-or-nothing.

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
