# Mind Memory Protocol

This tool contains all the context you need to use mind effectively.
After this, you can proceed with space_create, memory_add, etc.

---

## IMPORTANT: Create Space First
Before adding memories, you MUST create a space with `space_create`.
Memory tools will fail with "Space X does not exist" if the space hasn't been created.

---

## ⚠️ CRITICAL: Space Naming Convention

**For software projects, use the directory/repo name as the space name.**

This is VITAL for future agents to find your knowledge. If you use arbitrary names like "my-project" or "test123", future agents won't know where to search.

### ✅ DO:
- `projects/mind` — if the repo/directory is named "mind"
- `projects/arcana-web` — if the repo is "arcana-web"
- `projects/api-gateway` — if the directory is "api-gateway"

### ❌ DON'T:
- `projects/my-awesome-app` — too vague
- `projects/work-stuff` — unclear
- `projects/test123` — meaningless

**Why**: Future agents will search by repo/directory name. Using the actual name makes your memories discoverable.

---

## Tag Conventions (suggested)

**Custom tags are allowed.** The following are RECOMMENDED conventions to keep things organized, but you can create any tag you need.

### Required prefixes (for spaces):
- `type:project` — code project spaces
- `type:user` — user preferences/settings
- `type:config` — cross-project configuration
- `type:learning` — learned knowledge
- `type:session` — session summaries

### Category tags (for memories):
- `cat:decision` — architectural decision
- `cat:bugfix` — bug fix
- `cat:pattern` — established pattern
- `cat:discovery` — technical discovery
- `cat:preference` — user preference
- `cat:config` — specific configuration
- `cat:summary` — session summary (use with type:session)

Before creating a new tag, search existing memories first (`search` or `memory_query`) to check for duplicate conventions.

---

## Space Structure

Organize memories into hierarchical spaces:
- `projects/<REPO_NAME>` — one space per project (use the actual repo/directory name!)
- `user/preferences` — global user preferences
- `user/patterns` — work patterns and conventions
- `global/config` — cross-project configuration
- `sessions/<REPO_NAME>` — session summaries and checkpoints (use repo name too!)

---

## When to Save (mandatory)

Call `memory_add` IMMEDIATELY after:
- Bug fix completed
- Architecture decision made
- Non-obvious technical discovery
- Configuration or environment change
- Pattern established (naming, structure, convention)
- User preference learned
- Any important context you want to preserve for future sessions

**When to link memories**: When adding a memory that depends on, extends, or contradicts another existing memory, pass `links_to` with references to related memories in `"space:name"` format (or bare `"name"` for same space). This lets future agents trace related decisions without searching. Common cases:
- A bugfix that relates to a prior decision
- A discovery that updates a previous pattern
- A config change driven by an earlier finding
- Two memories about the same feature or subsystem

Pass memory references to `links_to` in `memory_add`, or use `link_create` for existing memories.

Composite operations are atomic all-or-nothing: if one step fails, no partial write is persisted (`memory_add` with `links_to`).

---

## Memory Content Format (strongly recommended)

Use this format for maximum usefulness to future agents:

**What**: One sentence — what was done
**Why**: What motivated it (user request, bug, performance, etc.)
**Where**: Files or paths affected
**Learned**: Gotchas, edge cases, decisions (omit if none)

Example:
**What**: Switched from sessions to JWT for authentication
**Why**: Session storage doesn't scale across multiple server instances
**Where**: src/middleware/auth.ts, src/routes/login.ts
**Learned**: Must set httpOnly and secure flags on cookies; refresh tokens need separate rotation logic

---

## Tier System (CPU-cache style)

Tiers help manage memory priority and auto-eviction:

| Tier | Name | Use Case | Limit/space |
|------|------|----------|-------------|
| T1 | hot | Critical active info (decisions, current preferences) | 25 |
| T2 | warm | Default for new memories | 50 |
| T3 | cold | Reference info (past discoveries, bugs, patterns) | 100 |
| T4 | frozen | Archive, accessible via search and memory_query | unlimited |

### Behaviors:
- **Auto-promote**: Reading a memory (`memory_read`) moves it up one tier (T4→T3→T2→T1)
- **Pin**: Set `pinned: true` on `memory_add` to make a memory immune to auto-promotion AND LRU eviction
- **LRU eviction**: When a tier is full, the least-recently-used non-pinned memory moves down one tier
- **T4 is special**: Returned by `search` and `memory_query` (with explicit `tier: 4` or no tier filter), but not shown in `space_get` hot memories preview.

---

## Tools Overview

| Category | Tools |
|----------|-------|
| Spaces | space_create, space_list, space_get, space_update, space_delete |
| Memories | memory_add, memory_update, memory_delete, memory_read |
| Links | link_create, link_delete |
| Search | search, memory_query, status |
| Checkpoint | checkpoint_save, checkpoint_done, checkpoint_load, checkpoint_list |

---

## Pagination

For tools that return lists (`memory_query`, `search`), results are paginated:
- `limit`: Number of results (default 25, max 500)
- `offset`: Zero-based index (default 0)
- Use `offset + limit` for next page

Response includes `pagination` object with `nextOffset` when more results exist.

---

## Common Errors

- "Space X does not exist": Create the space first with `space_create`
- "Memory with id X does not exist": Use `memory_query` or `search` to get valid IDs
- "T1 is full": Unpin some memories to allow LRU eviction, or let the system auto-evict

---

## Session Workflow

1. **Start**: Recover context: `checkpoint_load`, then `space_get` (use repo name!)
2. **Work**: Add memories as you go: `memory_add` with tags and `links_to`
3. **Query**: Find context: `memory_query`, `search`
4. **Checkpoint**: Save work progress: `checkpoint_save` (keep fresh as you go)
5. **Close**: Complete checkpoint: `checkpoint_done`, then session summary via `memory_add` to `sessions/<REPO_NAME>`

---

## Example Workflow

# 1. Create a project space (USE THE REPO NAME!)
space_create {
  name: "projects/mind",  # <-- actual repo name
  description: "Mind project decisions and patterns",
  tags: ["type:project"]
}

# 2. Add a decision memory
memory_add {
  space: "projects/mind",
  name: "JWT over sessions for auth",
  content: "**What**: Switched from sessions to JWT...\n**Why**: Scale across instances...",
  tags: ["cat:decision"]
}

# 3. Add a related discovery, linked to the decision by name
memory_add {
  space: "projects/mind",
  name: "Refresh token rotation needed",
  content: "**What**: JWT requires refresh token rotation logic...\n**Why**: Caused by JWT decision...",
  tags: ["cat:discovery"],
  links_to: ["JWT over sessions for auth"]  # <-- bare name, same space
}

# 4. Later, query for decisions
memory_query { space: "projects/mind", tag: "cat:decision" }

# 5. Read a memory to see its linked context
memory_read { space: "projects/mind", name: "JWT over sessions for auth" }
# → returns content + links_to + linked_by (with "space:name" refs)

# 6. Search across all spaces (including T4 frozen)
search { query: "authentication" }

# 7. End of session: summarize (use repo name!)
memory_add {
  space: "sessions/mind",  # <-- repo name
  name: "session-2026-03-07",
  content: "## Goal: Implement MCP improvements\n## Discoveries: ...",
  tags: ["type:session", "cat:summary"],
  links_to: ["projects/mind:JWT over sessions for auth", "projects/mind:Refresh token rotation needed"]
}
