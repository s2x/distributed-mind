---
name: mind-management
description: >
  MANDATORY skill for ALL tasks when mind MCP server is available.
  Activate for any work: coding, research, debugging, design, planning,
  conversations, or any task where context should survive the session.
  Mind is always on — not optional, REQUIRED. If mind MCP tools are
  available, this skill applies. No exceptions.
license: MIT
---

# Mind Management Protocol

This skill is **MANDATORY**. When mind MCP is available, you MUST use it for every session. This applies to ALL work — coding, research, planning, debugging, design reviews, conversations. If something is worth doing, it's worth remembering.

## Why This Exists

Without persistent memory:
- Your context dies when the session ends
- Future agents repeat mistakes you already solved
- Decisions lack traceable rationale
- Session continuity breaks on context resets

With mind:
- Every agent inherits the knowledge of every previous agent
- Decisions form a traceable graph — not isolated notes
- Recovery from compaction is instant, not guesswork
- The user never has to re-explain context

---

## Session Lifecycle

Every session follows this lifecycle. No exceptions.

### 1. RECOVER — Before anything else

```
checkpoint_load { space: "<project>" }
```

Always attempt recovery first. If no active checkpoint exists, the response will tell you — proceed to step 2.

### 2. ORIENT — Understand what exists

```
space_get { name: "<project>" }
memory_query { space: "<project>", limit: 10 }
search { query: "<current-task-keywords>", space: "*" }
```

`space_get` returns the space details plus a preview of hot (T1+T2) memories — use this to quickly understand what's active. Then query and search for anything related to your current task.

If the space doesn't exist yet:

```
space_create {
  name: "projects/<repo-name>",
  description: "Context and decisions for <repo-name>",
  tags: ["type:project"]
}
```

**Space naming is critical.** Always use the actual repo/directory name: `projects/mind`, `projects/api-gateway`. Never `projects/my-stuff` or `projects/test123`. Future agents find memories by searching the repo name.

### 3. WORK — Persist as you go

This is the core loop. Every significant action produces a memory or checkpoint update. Details in sections below.

### 4. CLOSE — Summarize and complete

```
checkpoint_done {
  space: "<project>",
  summary: "What was accomplished in this session"
}

memory_add {
  space: "sessions/<repo>",
  name: "session-YYYY-MM-DD-<topic>",
  content: "## Goal\n...\n## Accomplished\n...\n## Decisions\n...\n## Open Items\n...",
  tags: ["type:session", "cat:summary"],
  links_to: ["<name-of-memory-created-this-session>"]
}
```

---

## When to Create Memories

Call `memory_add` **immediately** after any of these — not later, not "when I'm done", NOW:

| Event | Tag | Example |
|-------|-----|---------|
| Decision made | `cat:decision` | "Chose JWT over sessions for auth" |
| Bug identified or fixed | `cat:bugfix` | "Fixed race condition in queue processor" |
| Non-obvious discovery | `cat:discovery` | "Bun's SQLite FTS5 has a trigger bug" |
| Pattern established | `cat:pattern` | "All MCP tools follow schema + handler pattern" |
| Config or env change | `cat:config` | "Enabled MIND_RAG=true for semantic search" |
| User preference learned | `cat:preference` | "User prefers terse responses, no summaries" |
| Architecture choice | `cat:decision` | "Chose monorepo with Bun workspaces" |
| Plan approved by user | `cat:decision` | "User approved 3-phase migration plan" |
| Research conclusion | `cat:discovery` | "Evaluated 3 ORMs, chose Drizzle for type safety" |

### Memory Content Format

Every memory should answer: **what, why, where, and what was learned**.

```
memory_add {
  space: "projects/mind",
  name: "MCP tool descriptions redesign",
  content: "**What**: Rewrote all MCP tool descriptions to be actionable and explain value.\n**Why**: Agents weren't using link features because descriptions were too generic.\n**Where**: cli/src/mcp/tools/*.ts, cli/src/resources/protocols/\n**Learned**: Agents learn from examples more than rules. Including links in the example workflow was the most impactful change.",
  tags: ["cat:decision", "cat:discovery"],
  links_to: ["<name-of-related-memory>"]
}
```

**Name format**: descriptive, kebab-case, scannable:
- `auth-jwt-token-expiry`
- `mcp-tool-descriptions-redesign`
- `sqlite-fts5-trigger-workaround`

---

## Tagging Discipline

Every memory and space MUST have at least one tag. Tags are how future agents filter and discover relevant context.

### Space tags (required on `space_create`)

| Tag | When |
|-----|------|
| `type:project` | Code project spaces |
| `type:user` | User preferences and settings |
| `type:session` | Session summaries and checkpoints |
| `type:config` | Cross-project configuration |
| `type:learning` | Learned knowledge and reference |

### Memory tags (required on `memory_add`)

| Tag | When |
|-----|------|
| `cat:decision` | Architectural or design decisions |
| `cat:bugfix` | Bug investigations and fixes |
| `cat:discovery` | Technical findings and learnings |
| `cat:pattern` | Established conventions to follow |
| `cat:preference` | User preferences |
| `cat:config` | Configuration specifics |
| `cat:summary` | Session summaries |

**Before inventing a new tag**, check what already exists:
```
search { query: "<your-topic>", space: "*" }
```
Look at the tags on returned results and reuse existing ones.

Custom tags are allowed — but prefer the conventions above for discoverability.

---

## Linking Memories

Links are how isolated notes become a knowledge graph. **Always link when a relationship exists.**

### When to Link

| Situation | Link label |
|-----------|------------|
| Bugfix caused by a prior decision | `caused_by` |
| Discovery that updates a pattern | `extends` |
| New decision that overrides an old one | `contradicts` |
| Implementation of a design decision | `implements` |
| Two memories about the same subsystem | `relates_to` |

### How to Link

**At creation time** (preferred — zero extra calls):

```
memory_add {
  space: "projects/mind",
  name: "auth-jwt-mobile-expiry-fix",
  content: "Fixed JWT early expiry on mobile due to clock skew...",
  tags: ["cat:bugfix"],
  links_to: ["auth-jwt-decision", "mobile-clock-skew-discovery"]
}
```

Use memory names from `memory_query` or `search` results — reference as bare name (same space) or `"space:name"` (cross-space).

**Between existing memories** (when you discover a relationship later):

```
link_create {
  sourceRef: "projects/mind:auth-jwt-mobile-expiry-fix",
  targetRef: "projects/mind:auth-jwt-decision",
  label: "caused_by"
}
```

References use `space:name` format. When both memories are in the same space, bare names also work.

### The Linking Habit

When you create a memory, always ask: **"Does this relate to something that already exists?"**

1. Run `memory_query` or `search` for related context
2. If related memories exist, pass their names to `links_to`
3. If you discover a relationship later, use `link_create`

This takes seconds and saves future agents minutes of searching.

---

## Checkpoint Discipline

Checkpoints are how work survives context resets and compaction. Be disciplined about them.

### When to Save a Checkpoint

| Event | What to save |
|-------|-------------|
| User approves a plan | `goal` + `pending` steps |
| Complete a subtask | Update `pending` (remove completed item) |
| Significant decision made | Add to `notes` |
| Before a risky operation | Full state snapshot |
| Every 15-20 minutes of work | Progress update |

```
checkpoint_save {
  space: "projects/mind",
  goal: "Redesign MCP tool descriptions",
  pending: "Update system instructions example, Regenerate test snapshots",
  notes: "User wants links to be more prominent. Descriptions should explain value, not just function.",
  relatedRefs: ["mcp-descriptions-decision", "linking-patterns"]
}
```

`relatedRefs` links memories by name (or `space:name`) to the checkpoint — when a future agent calls `checkpoint_load`, it gets these memories as context.

### When to Complete a Checkpoint

```
checkpoint_done {
  space: "projects/mind",
  summary: "Redesigned all MCP descriptions. Added linking examples to workflow. Tests passing."
}
```

---

## Tier System

Mind uses a CPU-cache-style tier system. Understanding it helps you organize knowledge effectively.

| Tier | Name | Purpose | Limit per space |
|------|------|---------|-----------------|
| T1 | hot | Critical active context | 25 |
| T2 | warm | Default for new memories | 50 |
| T3 | cold | Reference, past patterns | unlimited |

**Key behaviors:**
- New memories start at T2 (warm) unless you specify a tier
- `memory_read` auto-promotes one tier up (T3→T2→T1)
- When a tier is full, the least-recently-used memory is evicted down
- `pinned` memories are immune to promotion and eviction

**Practical guidance:**
- Active decisions and current preferences → T1 (or let auto-promotion handle it)
- General context → T2 (default, no action needed)
- Historical reference → T3
- Don't manually manage tiers unless you have a reason — the auto-promotion system works

---

## Tool Quick Reference

| Tool | Purpose |
|------|---------|
| `space_create` | Create space (required before adding memories). Tags required. |
| `space_get` | Get space details + hot memories preview |
| `space_list` | List spaces, optionally by tag |
| `space_update` | Update description and/or tags |
| `space_delete` | Delete space + all contents permanently |
| `memory_add` | Add memory with tags (required) and optional links |
| `memory_read` | Read memory content + links (+ auto-promote tier). Use `noPromote:true` for read without side effects. |
| `memory_update` | Update name, content, or replace tags |
| `memory_delete` | Delete memory + all its links |
| `search` | Full-text search (FTS5). Finds all memories including cold tier. Space required, use `"*"` for all. |
| `memory_query` | Query by metadata (tag, tier, date range). Space required, use `"*"` for all. |
| `status` | Storage stats (counts per tier, links, spaces) |
| `link_create` | Link two memories by ref (`space:name`). Add a label. |
| `link_delete` | Remove a link between two memories |
| `checkpoint_save` | Save/update session state (goal, pending, notes) |
| `checkpoint_load` | Recover most recent active checkpoint |
| `checkpoint_done` | Mark checkpoint complete with summary |
| `checkpoint_list` | List checkpoints by status |
| `system_instructions` | Get full protocol documentation |

---

## Enforcement Checklist

These are requirements, not suggestions:

1. **Session start** → `checkpoint_load` before any work
2. **Plan approved** → `checkpoint_save` immediately
3. **Significant event** → `memory_add` with tags NOW, not later
4. **Related memory exists** → Link it via `links_to` or `link_create`
5. **Subtask done** → Update checkpoint (`checkpoint_save`)
6. **Session end** → `checkpoint_done` + session summary memory

### You're breaking the rules if:

- You've done significant work without a single `memory_add`
- You created a memory without tags
- You created a memory that clearly relates to an existing one but didn't link it
- The user asks "what were we working on?" and you can't answer from mind
- You're reimplementing something that was done in a prior session
- Your checkpoint is stale (goal/pending doesn't match current state)

If any of these apply: **stop and fix it before continuing.**

---

## Anti-Patterns

| Don't | Do |
|-------|-----|
| "I'll save it later" | Save immediately — you may not get "later" |
| "The code explains itself" | Code says what, not why — persist the why |
| "This is too minor" | If you thought about it, it's worth a memory |
| "I don't know the related memory ID" | Query first: `memory_query` or `search` return IDs |
| "I'll just use tags, no links" | Tags are categories. Links are relationships. Use both. |
| "Let me finish everything first, then persist" | Persist as you go — compaction can happen anytime |
