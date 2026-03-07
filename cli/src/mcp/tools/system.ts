import { z } from 'zod';

const SystemInstructionsSchema = z.object({});

const FULL_INSTRUCTIONS = `# Mind Memory Protocol

## ⚠️ IMPORTANT: CALL THIS TOOL FIRST
If you haven't called \`system_instructions\` yet, call it NOW to get the full protocol guidelines.
This tool contains all the context you need to use mind effectively.
After this, you can proceed with space_create, memory_add, etc.

---

## IMPORTANT: Create Space First
Before adding memories, you MUST create a space with \`space_create\`. 
Memory tools will fail with "Space X does not exist" if the space hasn't been created.
Use hierarchical naming: \`projects/name\`, \`user/preferences\`, \`sessions/project-name\`.

---

## Tag Conventions (suggested)

**Custom tags are allowed.** The following are RECOMMENDED conventions to keep things organized, but you can create any tag you need.

### Required prefixes (for spaces):
- \`type:project\` — code project spaces
- \`type:user\` — user preferences/settings  
- \`type:config\` — cross-project configuration
- \`type:learning\` — learned knowledge
- \`type:session\` — session summaries

### Category tags (for memories):
- \`cat:decision\` — architectural decision
- \`cat:bugfix\` — bug fix
- \`cat:pattern\` — established pattern
- \`cat:discovery\` — technical discovery
- \`cat:preference\` — user preference
- \`cat:config\` — specific configuration
- \`cat:summary\` — session summary (use with type:session)

Before creating a new tag, ALWAYS list existing tags first (\`memory_tags_list\` or \`space_list --tags\`) to check for duplicates.

---

## Space Structure

Organize memories into hierarchical spaces:
- \`projects/<name>\` — one space per project (e.g., \`projects/mind\`, \`projects/webapp\`)
- \`user/preferences\` — global user preferences
- \`user/patterns\` — work patterns and conventions
- \`global/config\` — cross-project configuration
- \`sessions/<project>\` — session summaries and checkpoints

---

## When to Save (mandatory)

Call \`memory_add\` IMMEDIATELY after:
- Bug fix completed
- Architecture decision made
- Non-obvious technical discovery
- Configuration or environment change
- Pattern established (naming, structure, convention)
- User preference learned
- Any important context you want to preserve for future sessions

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
| T4 | frozen | Archive, only accessible via search | unlimited |

### Behaviors:
- **Auto-promote**: Reading a memory (\`memory_read\`) moves it up one tier (T4→T3→T2→T1)
- **Pin**: Use \`memory_pin\` to make a memory immune to auto-promotion AND LRU eviction
- **LRU eviction**: When a tier is full, the least-recently-used non-pinned memory moves down one tier
- **T4 is special**: Only accessible via \`search\`. Never returned by \`memory_list\` or \`memory_query\`.

---

## Tools Overview

| Category | Tools |
|----------|-------|
| Spaces | space_create, space_list, space_get, space_update, space_rename, space_delete, space_tag_add, space_tag_remove |
| Memories | memory_add, memory_get, memory_get_by_id, memory_list, memory_query, memory_update, memory_delete, memory_read, memory_tag_add, memory_tag_remove, memory_tags_list |
| Tiers | memory_promote, memory_demote, memory_pin, memory_unpin |
| Links | link_create, link_delete, links_list |
| Search | search, status |
| Checkpoint | checkpoint_set, checkpoint_complete, checkpoint_recover, checkpoint_list |

---

## Pagination

For tools that return lists (\`memory_query\`, \`memory_list\`, \`search\`), results are paginated:
- \`limit\`: Number of results (default 25, max 500)
- \`offset\`: Zero-based index (default 0)
- Use \`offset + limit\` for next page

Response includes \`pagination\` object with \`nextOffset\` when more results exist.

---

## Common Errors

- "Space X does not exist": Create the space first with \`space_create\`
- "Memory with id X does not exist": Use \`memory_list\`, \`memory_query\`, or \`search\` to get valid IDs
- "T1 is full": Either promote memories to make room, or unpin some memories to allow LRU eviction

---

## Session Workflow

1. **Start**: Create/check space: \`space_create\` or \`space_list\`
2. **Work**: Add memories as you go: \`memory_add\` (important decisions, bugs, patterns)
3. **Query**: Find context later: \`memory_query\`, \`search\`, \`memory_list\`
4. **Checkpoint** (optional): Save work progress: \`checkpoint_set\`
5. **Close**: Summarize session: \`memory_add\` to \`sessions/<project>\` with \`type:session, cat:summary\`

---

## Example Workflow

# 1. Create a project space
space_create { 
  name: "projects/mind", 
  description: "Mind project decisions and patterns",
  tags: ["type:project"]
}

# 2. Add a decision memory
memory_add {
  space: "projects/mind",
  name: "JWT over sessions for auth",
  content: "**What**: Switched from sessions to JWT...\\n**Why**: Scale across instances...",
  tags: ["cat:decision"]
}

# 3. Later, query for decisions
memory_query { space: "projects/mind", tag: "cat:decision" }

# 4. Search across all spaces
search { query: "authentication" }

# 5. End of session: summarize
memory_add {
  space: "sessions/mind",
  name: "session-2026-03-07",
  content: "## Goal: Implement MCP improvements\\n## Discoveries: - Protocol instructions can be centralized\\n## Accomplished: - Improved error messages\\n## Relevant Files: - cli/src/mcp/server.ts",
  tags: ["type:session", "cat:summary"]
}
`;

export function createSystemTools() {
    return {
        system_instructions: {
            schema: SystemInstructionsSchema,
            handler: async () => {
                return {
                    content: [{ type: 'text', text: FULL_INSTRUCTIONS }],
                    instructions_version: '1.0.0',
                };
            },
        },
    };
}
