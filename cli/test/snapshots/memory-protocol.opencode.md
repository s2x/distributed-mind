# Mind Memory Protocol (mind)

Use this protocol whenever the `mind` MCP server is available.

## MANDATORY: First Actions (execute before any other work)

1. `checkpoint_load` — recover previous session state for the current project space
2. `space_get` — check if the project space exists (use repo/directory name: `projects/<repo-name>`)
3. If space doesn't exist: `space_create` with `tags: ["type:project"]`
4. `memory_query` or `search` — find context related to the current task

If this is your first time using mind tools in this session, call `system_instructions` to get the full usage protocol.

## MANDATORY: During Work

After EVERY significant event (decision, bug fix, discovery, config change, user preference):

```
memory_add {
  space: "projects/<repo-name>",
  name: "<descriptive-kebab-name>",
  content: "**What**: ...\n**Why**: ...\n**Where**: ...\n**Learned**: ...",
  tags: ["cat:decision"],
  links_to: ["<space:name of related memory>"]
}
```

- Every memory MUST have at least 1 tag: `cat:decision`, `cat:bugfix`, `cat:discovery`, `cat:pattern`, `cat:preference`, `cat:config`
- Always check for related memories (`memory_query` or `search`) and pass their names to `links_to` (use `"space:name"` format or bare name for same space)
- Update checkpoint after completing subtasks: `checkpoint_save`

## MANDATORY: Session End

1. `checkpoint_done` — mark the checkpoint complete with a summary
2. `memory_add` — save session summary to `sessions/<repo-name>` with tags `["type:session", "cat:summary"]` and `links_to` referencing memories created this session

## Post-Compaction Recovery

If context resets or compaction happens:

1. `checkpoint_load` for the active project
2. `memory_query` and/or `search` for recent context
3. Re-establish goal, pending steps, and relevant files before making edits

## You Are Breaking the Rules If

- You did significant work without calling `memory_add`
- You created a memory without tags
- You created a memory related to an existing one without linking it
- Your checkpoint is stale (doesn't reflect current progress)
- You started working without calling `checkpoint_load` first
