# Mind Memory Protocol (mind)

Use this protocol whenever the `mind` MCP server is available.

## Core Rules

- Before using mind tools, call `mind_system_instructions` to learn correct usage details.
- Create project spaces using the repository name (example: `projects/mind`).
- Save key context immediately after important work (decisions, bug fixes, discoveries, config changes, patterns).
- Prefer tags that keep memories easy to query later (example: `cat:decision`, `cat:bugfix`).

## Session Continuity

- During active work, keep checkpoints updated with `checkpoint_set`.
- On completion, mark checkpoints done with `checkpoint_complete`.

## Post-Compaction Guidance

Follow this post-compaction recovery checklist whenever context is compacted.

If context compaction/reset happens:

1. Recover the latest checkpoint with `checkpoint_recover` for the active project.
2. Query recent context with `memory_query` and/or `search` before making changes.
3. Re-establish current goal, pending work, and relevant files in your working context.

## Minimal Workflow

1. Ensure project space exists: `space_create` (once) or `space_get`.
2. Record important facts with `memory_add` as you work.
3. Use `checkpoint_set` to track goal and pending items.
4. End sessions with a concise summary memory in `sessions/<repo>`.
