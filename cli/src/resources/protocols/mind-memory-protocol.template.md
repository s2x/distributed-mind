# Mind Memory Protocol ({{protocolLabel}})

{{#if useWhenConnected}}Use this protocol when {{connectedAgentLabel}} is connected to the `mind` MCP server.{{/if}}{{#if useBeforeToolsWording}}Use this protocol whenever the `mind` MCP server is available.{{/if}}

## Core Rules

{{#if useBeforeToolsWording}}- Before using mind tools, call `mind_system_instructions` to learn correct usage details.{{/if}}{{#if useCallBeforeSessionWording}}- Call `mind_system_instructions` before using memory tools in a new session.{{/if}}
- Use repo-based project spaces (example: `projects/mind`).
- Persist important context immediately (decisions, bug fixes, discoveries, config updates).
- Keep tags consistent (`cat:decision`, `cat:bugfix`, `cat:discovery`, `type:project`).
- Link related memories so future agents can trace connections: pass `links_to_ids` when adding a memory that depends on or extends another, use `memory_patch add_links_to_ids` for existing memories, or `link_create` for labeled relationships. Get IDs from `memory_list` or `memory_query`.
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
