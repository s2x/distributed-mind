# AGENTS.md — Project guide for AI agents and maintainers

This document describes the **mind** project: its architecture, behavior, technical choices, and how to use it. It is intended for AI agents and human maintainers. **Agents that modify this codebase must keep this file updated** when they change architecture, add commands, change config, or alter behavior (see [Keeping this document updated](#keeping-this-document-updated)).

---

## 1. Project overview

**mind** is a CLI tool for persistent long-term memory — tracking thoughts, ideas, tasks, and knowledge. Data is organized into named **spaces**, each containing **memories** with full-text search, tags, links, and a 4-tier CPU-cache-style access-frequency system.

- **Runtime:** [Bun](https://bun.sh/)
- **Language:** TypeScript (strict mode, ESNext)
- **Entry point:** the **`mind`** Bash script at project root; invokes `cli/src/mind.ts`. Supports subcommands: `serve` (HTTP server), `mcp` (MCP server), `setup` (agent configuration), and `update` (self-update from GitHub releases). Also supports `--complete` flag to delegate to `cli/src/complete.ts` (not yet implemented).
- **Persistence:** SQLite database at `data/mind.db` (path configurable via `MIND_DATA_DIR` env var or `MIND_DB_PATH` for full path override). The legacy `brain.json` is supported as a migration source via `mind import`.
- **RAG/Embeddings:** Optional semantic search via OpenAI `text-embedding-3-small`. Enable with `MIND_RAG=true` + `OPENAI_API_KEY`. Embeddings stored as BLOBs in SQLite; generated fire-and-forget on add/update.
- **Layout:** **`cli/`** contains all CLI code and tests. **`web/`** contains the web server and frontend (Dockerized, `restart: unless-stopped` in docker-compose). **`scripts/`** contains E2E test scripts.

---

## 2. Architecture

### 2.1 High-level flow

```
User → ./mind <command> [args] [--flag value]
         ↓
    mind (Bash script at repo root)
         ↓
    bun run cli/src/mind.ts "$@"
         ↓
    executeCommand(args, store, logger)
         ↓
    CLI command registry (atomic command modules) → command-executor (dispatch)
         ↓
    MindStore (SQLite) + Logger (stdout/stderr)
```

- **Entry:** `cli/src/mind.ts` creates store/logger and delegates all command handling to `executeCommand` from `cli/src/cli/command-executor.ts`.
- **Commands:** Declared as atomic modules in `cli/src/cli/commands/*.ts` and registered by `cli/src/cli/commands/index.ts`. `cli/src/cli/command-executor.ts` acts as dispatcher/registry.
- **Storage:** All persistent data goes through the `MindStore` interface (defined in `cli/src/store/mind-store.ts`), implemented by `createSqliteStore` (`cli/src/store/sqlite-store.ts`). Uses bun's native `bun:sqlite`.
- **FTS:** Full-text search uses SQLite's FTS5 with a porter tokenizer. FTS is synced **manually** (bun:sqlite has a bug with content-sync triggers — see [§ 3](#3-technical-considerations)).
- **Output:** All user-facing messages go through the `Logger` interface (`cli/src/helpers/logger.ts`), so tests can swap in a mock logger.
- **Web/API:** The HTTP API server is in `cli/src/api/` and serves static frontend assets from `web/public/`.

### 2.2 Main modules and responsibilities

| Module                | Path                              | Responsibility                                                                                                                                                             |
| --------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry script          | `mind` (Bash)                     | Resolve repo root, dispatch to `cli/src/mind.ts`.                                                                                                                          |
| Entry module          | `cli/src/mind.ts`                 | Bootstrap store/logger and run CLI command executor.                                                                                                                       |
| CLI command modules   | `cli/src/cli/commands/*.ts`       | Atomic command definitions/handlers grouped by domain (`spaces`, `memories`, `tiers`, `links`, `search`, `status`, `tags`, `checkpoint`, `guide`, `migration`, `runtime`). |
| CLI executor          | `cli/src/cli/command-executor.ts` | Load command groups from `cli/commands/index.ts`, dispatch matched command, and render help sections.                                                                      |
| Arg parser            | `cli/src/cli/arg-parser.ts`       | Match CLI args to a shape (positional `<param>`, aliases `a\|b`, `--flag value`), extract params + flags, render help.                                                     |
| Setup/runtime helpers | `cli/src/cli/setup.ts`            | Agent setup + detached process management helpers for MCP/web servers. Uses a capability-driven adapter model (L1 MCP, L2 instruction injection, L3 hooks automation) with explicit status (`supported`/`unsupported`/`unverified`) and visible fallback diagnostics. OpenCode setup remains idempotent/non-destructive and injects a managed Memory Protocol instructions file loaded from markdown resources. Claude setup now injects managed protocol instructions into `~/.claude/CLAUDE.md` and supports opt-in hook automation via `MIND_SETUP_CLAUDE_ENABLE_HOOKS=true` (non-blocking fallback). |
| MindStore interface   | `cli/src/store/mind-store.ts`     | Abstract interface for all data operations.                                                                                                                                |
| SQLite store          | `cli/src/store/sqlite-store.ts`   | Full `MindStore` implementation using `bun:sqlite`. Handles tiers, LRU eviction, tags, links, FTS, status, import. Generates embeddings in background when RAG enabled.    |
| Schema                | `cli/src/store/schema.ts`         | SQLite schema (tables, indexes, FTS5 table). No triggers (see §3). `initializeDatabase()` function. Schema version 5 (migrates v1→v2→v3→v4→v5).                            |
| MCP server            | `cli/src/mcp/server.ts`           | MCP stdio server using `@modelcontextprotocol/sdk`. Exposes 29 tools.                                                                                                      |
| MCP tools             | `cli/src/mcp/tools/`              | Tool implementations: `spaces.ts`, `memories.ts`, `tiers.ts`, `links.ts`, `search.ts`, `checkpoint.ts`, `system.ts`.                                                       |
| API server            | `cli/src/api/server.ts`           | Bun HTTP server that serves `/api/*` routes and static assets from `web/public/`.                                                                                          |
| API router            | `cli/src/api/router.ts`           | Route matcher/dispatcher for API endpoints.                                                                                                                                |
| API routes            | `cli/src/api/routes/*.ts`         | Atomic REST route declarations grouped by domain (`spaces`, `memories`, `search`, `status`).                                                                               |
| Config                | `cli/src/config.ts`               | `CONFIG.dataDir`, `CONFIG.dbPath`, `CONFIG.legacyJsonPath`, `CONFIG.rag`. Respects `MIND_DATA_DIR` and `MIND_DB_PATH` env vars. `TIER_LIMITS` per-tier capacity constants. |
| Types                 | `cli/src/types.ts`                | All domain types: `Space`, `Memory`, `Link`, `Tier`, `SearchResult`, `StatusResult`, `LegacyBrain`, etc.                                                                   |
| Helpers               | `cli/src/helpers/*.ts`            | Shared helpers: logger, tag normalization, formatting/memory refs, markdown resource loading, and RAG helpers.                                                             |
| Protocol resources    | `cli/src/resources/protocols/*.md`| Canonical markdown sources for OpenCode setup protocol injection and MCP `system_instructions` tool content.                                                               |
| Web frontend          | `web/public/*`                    | SPA for browsing and editing spaces and memories.                                                                                                                          |

### 2.3 Data model

- **Brain:** A SQLite database (`mind.db`) at `data/` in the repo root (or `MIND_DATA_DIR`).
- **Space:** `{ name: string, description: string, hidden: boolean, tags: string[], created_at, updated_at }`. Identified by name (primary key).
- **Hidden spaces:** Spaces can be marked hidden and are omitted from default `list`; include them with `list --hidden`.
- **Checkpoint spaces:** Session checkpoints are stored in hidden derived spaces named `<space>:sessions`.
- **Memory:** `{ id: number, space_name: string, name: string, content: string, tier: 1|2|3|4, pinned: boolean, access_count: number, last_accessed_at: string|null, tags: string[], embedding: Float32Array|null, created_at, updated_at, changed_at }`. Identified by `(space_name, name)`.
- **Tier system:**
    - 🔴 **T1 (hot)** — frequently accessed (limit: 25/space)
    - 🟡 **T2 (warm)** — default for new memories (limit: 50/space)
    - 🔵 **T3 (cold)** — rarely used (limit: 100/space)
    - 💠 **T4 (frozen)** — archive tier; unlimited capacity; only reachable via `search`, never via `list`
    - Auto-promotion on CLI `read`: each read promotes one tier up (T4→T3, T3→T2, T2→T1). Skipped silently if pinned or if destination is full and all are pinned.
    - **LRU eviction:** when a tier is full, the least-recently-used non-pinned memory is demoted one tier down (no cascading). T3 LRU evicts to T4 (unlimited). If all memories in a tier are pinned, `addMemory` and `promote` throw an error; `recordAccess` promotion silently skips.
    - New memories can be added to T1, T2, or T3 only; `--tier 4` is rejected at the command level.
    - **Pinned memories are immune to auto-promotion and LRU eviction.**
- **Link:** Directional edge between two memories with a label (default: `"related"`). Stored as `(source_id, target_id, label)`.
- **Tags:** Both spaces and memories can have multiple string tags. Tags are normalized on input: converted to lowercase, leading `#` stripped, validated against allowed characters (`a-z`, `0-9`, `-`, `_`, `.`, `:`, `/`, `=`, `+`, `@`). Tags cannot be empty or contain spaces. Displayed with `#` prefix in CLI output.
- **FTS:** `memories_fts` virtual FTS5 table, synced manually on add/update/delete. Supports fuzzy matching via porter tokenizer.

### 2.4 SQLite schema tables

| Table          | Key columns                                                                                                                                                               | Notes                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `meta`         | `key`, `value`                                                                                                                                                            | Tracks `schema_version`.                                         |
| `spaces`       | `name` (PK), `description`, `hidden`, timestamps                                                                                                                          |                                                                  |
| `space_tags`   | `space_name` (FK), `tag`                                                                                                                                                  | Cascades on space rename/delete.                                 |
| `memories`     | `id` (PK), `space_name` (FK), `name`, `content`, `tier`, `pinned`, `access_count`, `last_accessed_at`, `embedding`, timestamps (`created_at`, `updated_at`, `changed_at`) | UNIQUE on `(space_name, name)`. Cascades on space delete/rename. |
| `memory_tags`  | `memory_id` (FK), `tag`                                                                                                                                                   | Cascades on memory delete.                                       |
| `links`        | `source_id` (FK), `target_id` (FK), `label`                                                                                                                               | No self-links. Cascades on memory delete.                        |
| `memories_fts` | FTS5 virtual table: `name`, `content`                                                                                                                                     | Synced manually (no triggers).                                   |

---

## 3. Technical considerations

- **Schema version:** Current schema is version 5. Existing v1 databases (tier `CHECK (tier BETWEEN 1 AND 3)`) are migrated automatically via a 12-step rename-and-recreate pattern in `MIGRATE_V1_TO_V2`. V2→V3 adds the `embedding BLOB` column. V3→V4 adds `changed_at` and backfills it from `updated_at`. V4→V5 adds `spaces.hidden` with default `0`.
- **Bun:** The project is run and tested with Bun. Use `bun run`, `bun test`, and Bun's built-in TypeScript + SQLite support. No separate compile step.
- **bun:sqlite FTS5 bug:** bun:sqlite (v1.2.10) cannot handle FTS5 `content=table` sync triggers — any UPDATE or DELETE on the source table errors with "N values for M columns". **Workaround:** `memories_fts` is a standalone FTS5 table (no `content=` option, no triggers). FTS is synced manually in `sqlite-store.ts` via `ftsInsert`, `ftsUpdate`, `ftsDelete` helpers called from `addMemory`, `updateMemory`, `deleteMemory`, `deleteMemoryByName`, `deleteSpace`, and `importFromJson`.
- **Styling:** Terminal output uses `bun-style` for bold, colors, etc. Tests assert on the styled strings.
- **Config / storage path:** `cli/src/config.ts` resolves `CONFIG.dbPath` from `MIND_DB_PATH` env var (full path override) or `MIND_DATA_DIR` env var + `mind.db` (defaults to `data/` at repo root). The web server uses `MIND_DATA_DIR` (or `/data` in Docker). `data/` is in `.gitignore`. HTTP idle timeouts are configurable via `MIND_MCP_IDLE_TIMEOUT` (default 120s) and `MIND_API_IDLE_TIMEOUT` (default 30s).
- **Setup capability model:** each agent adapter declares L1 (MCP), L2 (instruction/protocol injection), and L3 (hooks/session automation) with status `supported`, `unsupported`, or `unverified`, plus confidence/evidence/fallback notes printed during `mind setup` flows. No silent capability skip.
- **Claude setup behavior:** `mind setup claude-code` deep-merges `~/.claude/settings.json`, writes/refreshes `~/.claude/instructions/mind-memory-protocol.md`, and upserts a managed block in `~/.claude/CLAUDE.md` pointing to that protocol. L3 hook automation is opt-in (`MIND_SETUP_CLAUDE_ENABLE_HOOKS=true`) and non-blocking; failures fall back to manual workflow guidance.
- **Capability declarations beyond wired adapters:** capability matrix includes `openclaw` as an **experimental** declaration (status-only, no setup wiring) and `vscode` / `antigravity` / `kiro` as roadmap-only entries (status declarations only, no setup wiring).
- **OpenCode setup behavior:** `mind setup opencode` deep-merges existing JSON config (preserving unknown keys), configures `mcp.mind` as local command transport (`type: "local"`, `command: ["<path-to-mind>", "mcp"]`), writes/refreshes `~/.config/opencode/instructions/mind-memory-protocol.md`, and ensures that exact path is present exactly once as the first entry in the OpenCode `instructions` list. L3 prudent session/compaction automation is default-on and non-blocking: setup writes a managed plugin at `~/.config/opencode/plugins/mind-automation.js` that handles `session.created`, `session.compacted`, `experimental.session.compacting`, and prudent session-end summaries with deterministic caps/idempotency.
- **Codex setup behavior:** `mind setup codex` appends (if missing) a local MCP stanza in `~/.codex/config.toml` with `command = "<path-to-mind>"` and `args = ["mcp"]` (stdio/local transport, no forced HTTP args).
- **Protocol sources:** OpenCode and Claude managed protocol payloads, plus MCP `system_instructions` payload, are sourced from markdown files in `cli/src/resources/protocols/` via `cli/src/helpers/markdown-resource.ts`.
- **Testing:** CLI tests live in `cli/test/`, use `bun:test`, and rely on:
    - **`test-store.ts`** (`cli/test/mocks/test-store.ts`): creates a temporary SQLite DB in `/tmp/` per test instance; returns `{ store, cleanup }`.
    - **`mocked-logger.ts`** (`cli/test/mocks/mocked-logger.ts`): captures `logInfo`/`logError` for assertions.
    - Test files: `cli/test/mind-store.spec.ts` (store-level), `cli/test/command-executor.spec.ts` (CLI-level), `cli/test/mcp-tools.spec.ts` (MCP tools), `cli/test/setup-opencode.spec.ts` (OpenCode setup/instruction injection), `cli/test/setup-capabilities.spec.ts` (capability declarations + fallback diagnostics), `cli/test/system-tools.spec.ts` (MCP system instructions source loading), and `cli/test/arg-parser.spec.ts` (arg parser).
    - **`scripts/test-rag.sh`**: E2E integration test for RAG. Requires `OPENAI_API_KEY`, makes real OpenAI API calls. Uses `MIND_DB_PATH` to create a temp DB. Run via `make test-rag` or directly.
- **Docker:** `web/Dockerfile` builds the web app; `docker-compose.yml` runs it with volume `./data` (or `BRAIN_DATA_DIR`) mounted at `/data`, port 3000, and `restart: unless-stopped`.
- **Dependencies:** Production: `bun-style`. Dev: `@types/bun`. Peer: `typescript ^5`.
- **Shell completion:** The `mind` bash script supports `--complete` flag, delegating to `cli/src/complete.ts`. This file is **not yet implemented**.

---

## 4. Usage

### 4.1 Setup

```bash
bun install
```

### 4.2 Running the CLI

From the project root:

```bash
./mind <command> [args] [--flag value]
```

Example: `./mind help`, `./mind create my-space "Description"`, `./mind search "auth" --tier 1`.

The `data/` directory and `mind.db` are created automatically on first run.

### 4.3 Running the Web Server

```bash
./mind serve start                  # Start HTTP server on port 3000
./mind serve start --port 8080      # Custom port
./mind serve start --detached       # Run in background
./mind serve stop                   # Stop detached server
```

### 4.4 Running the MCP Server

```bash
./mind mcp                          # Start MCP server (stdio transport)
./mind mcp start --http             # Start MCP over HTTP (foreground)
./mind mcp start --http --detached  # Start MCP over HTTP (background)
./mind mcp stop                     # Stop detached MCP server
```

Add to your agent's MCP config:

**OpenCode** (`~/.config/opencode/opencode.json`):

```json
{
    "mcp": {
        "mind": {
            "type": "local",
            "command": ["/absolute/path/to/mind", "mcp"],
            "enabled": true
        }
    },
    "instructions": [
        "~/.config/opencode/instructions/mind-memory-protocol.md"
    ]
}
```

**Claude Code** (`~/.claude/settings.json`):

```json
{
    "mcpServers": {
        "mind": {
            "url": "http://localhost:7438/mcp"
        }
    }
}
```

### 4.5 Setting up agents

```bash
./mind setup claude-code   # Auto-configure Claude Code
./mind setup opencode      # Auto-configure OpenCode
./mind setup cursor        # Auto-configure Cursor
./mind setup windsurf     # Auto-configure Windsurf
./mind setup codex        # Auto-configure Codex
./mind setup gemini-cli   # Auto-configure Gemini CLI
```

`./mind setup` (without an agent) prints an explicit capability matrix for all supported adapters plus non-wired declarations. It now prints full per-level status/confidence/evidence/fallback diagnostics for each listed adapter. OpenClaw is intentionally marked **experimental** (unverified/unsupported, no setup wiring), and Cursor L2/L3 remain intentionally `unverified` until concrete implementation evidence exists.

### 4.6 Running tests

```bash
# Unit tests
bun test cli/test

# RAG E2E integration test (requires OPENAI_API_KEY, makes real API calls)
make test-rag
# or directly:
OPENAI_API_KEY=sk-... ./scripts/test-rag.sh

# Maintainer release flows
make release-patch
make release-minor
make release-major
make release-simulate TYPE=patch
```

### 4.7 Migrating from legacy brain.json

```bash
./mind import
```

Reads `data/brain.json` (or `$MIND_DATA_DIR/brain.json`) and imports all spaces and memories into SQLite at tier 2.

### 4.8 CLI commands

| Intent              | Command               | Aliases                                     | Params                         | Flags                                                                 | Description                                                                                                                                                                     |
| ------------------- | --------------------- | ------------------------------------------- | ------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- | ------ | --- | --------------------- | --------- | ---------------------------------------- |
| Help                | `help`                | `h`                                         | —                              | —                                                                     | List all commands.                                                                                                                                                              |
| Create space        | `create`              | `c`                                         | `<space>` `<description>`      | `--tags`                                                              | Create a new space (comma-sep tags).                                                                                                                                            |
| List spaces         | `list`                | `ls`, `l`                                   | —                              | `--tag`, `--hidden`                                                   | List all visible spaces by default (optionally include hidden).                                                                                                                 |
| List memories       | `list`                | `ls`, `l`                                   | `<space>`                      | `--tier`, `--tag`                                                     | List T1+T2 memories in a space (use `--tier 3` for cold; `--tier 4` returns empty).                                                                                             |
| Delete space        | `delete`              | `d`                                         | `<space>`                      | —                                                                     | Delete a space and all its memories.                                                                                                                                            |
| Rename space        | `rename`              | `rn`                                        | `<old>` `<new>`                | —                                                                     | Rename a space.                                                                                                                                                                 |
| Describe space      | `describe`            | `ds`                                        | `<space>` `<description>`      | —                                                                     | Change a space's description.                                                                                                                                                   |
| Update space        | `update`              | —                                           | `<space>`                      | `--description`, `--hidden`, `--no-hidden`                            | Update space description and/or visibility.                                                                                                                                     |
| Tag space           | `tag`                 | `t`                                         | `<space>` `<tag>`              | —                                                                     | Add a tag to a space.                                                                                                                                                           |
| Untag space         | `untag`               | —                                           | `<space>` `<tag>`              | —                                                                     | Remove a tag from a space.                                                                                                                                                      |
| Add memory          | `add`                 | `a`                                         | `<space>` `<name>` `<content>` | `--tags`, `--tier`                                                    | Add a memory.                                                                                                                                                                   |
| Read memory         | `read`                | `r`                                         | `<space>` `<name>`             | —                                                                     | Print a memory (bumps access + auto-promote).                                                                                                                                   |
| Edit memory         | `edit`                | `e`                                         | `<space>` `<name>` `<content>` | —                                                                     | Update a memory's content.                                                                                                                                                      |
| Remove memory       | `remove`              | `rm`                                        | `<space>` `<name>`             | —                                                                     | Remove a memory by name.                                                                                                                                                        |
| Tag memory          | `tag`                 | `t`                                         | `<space>` `<name>` `<tag>`     | —                                                                     | Add a tag to a memory.                                                                                                                                                          |
| Untag memory        | `untag`               | —                                           | `<space>` `<name>` `<tag>`     | —                                                                     | Remove a tag from a memory.                                                                                                                                                     |
| Promote             | `promote`             | `up`                                        | `<space>` `<name>`             | —                                                                     | Move memory one tier up (T4→T3, T3→T2, T2→T1).                                                                                                                                  |
| Demote              | `demote`              | `down`                                      | `<space>` `<name>`             | —                                                                     | Move memory one tier down (T1→T2, T2→T3, T3→T4).                                                                                                                                |
| Pin                 | `pin`                 | —                                           | `<space>` `<name>`             | —                                                                     | Pin a memory (immune to auto-promotion).                                                                                                                                        |
| Unpin               | `unpin`               | —                                           | `<space>` `<name>`             | —                                                                     | Unpin a memory.                                                                                                                                                                 |     | Link | `link` | —   | `<source>` `<target>` | `--label` | Link two memories (`space/name` format). |
| Unlink              | `unlink`              | —                                           | `<source>` `<target>`          | —                                                                     | Remove a link between memories.                                                                                                                                                 |
| Show links          | `links`               | —                                           | `<space>` `<name>`             | —                                                                     | Show all links for a memory.                                                                                                                                                    |
| Search              | `search`              | `s`                                         | `<query>`                      | `--space`, `--tag`, `--tier`, `--detail`                              | Full-text search across memories (includes T4). Default output includes memory ref, tier, and changed timestamp. `--detail` adds content preview. Use `term*` for prefix match. |
| Query               | `query`               | `q`                                         | —                              | `--space`, `--tag`, `--tier`, `--from`, `--to`, `--limit`, `--offset` | Query memories by metadata/date with pagination (ordered by latest semantic memory changes).                                                                                    |
| Status (global)     | `status`              | —                                           | —                              | —                                                                     | Show storage info and per-tier breakdown.                                                                                                                                       |
| Status (space)      | `status`              | —                                           | `<space>`                      | —                                                                     | Show tier breakdown for a specific space.                                                                                                                                       |
| List tags           | `tags`                | `tgs`                                       | —                              | `--spaces`, `--memories`                                              | List all tags in the system (defaults to both).                                                                                                                                 |
| Checkpoint set      | `checkpoint set`      | `cp set`                                    | `<space>` `<goal>` `<pending>` | `--notes`                                                             | Create or update an active checkpoint in `<space>:sessions`.                                                                                                                    |
| Checkpoint complete | `checkpoint complete` | `cp complete`, `checkpoint done`, `cp done` | `<space>` `<id>` `<what>`      | —                                                                     | Complete a checkpoint, mark tags, and demote tier.                                                                                                                              |
| Checkpoint recover  | `checkpoint recover`  | `cp recover`                                | `<space>`                      | `--history`                                                           | Recover the most recent active checkpoint (optionally include completed history).                                                                                               |
| Checkpoint list     | `checkpoint list`     | `cp list`                                   | `<space>`                      | `--status`                                                            | List checkpoints from `<space>:sessions`.                                                                                                                                       |
| Guide               | `guide`               | `g`                                         | —                              | —                                                                     | Show usage guide (human mode).                                                                                                                                                  |
| Guide (mode)        | `guide`               | `g`                                         | `<mode>`                       | —                                                                     | Show guide (`agent` or `human`).                                                                                                                                                |
| Import              | `import`              | —                                           | —                              | —                                                                     | Import legacy `brain.json` into SQLite.                                                                                                                                         |
| Update              | `update`              | —                                           | —                              | `--check`, `--version`, `--repo`                                      | Update mind from GitHub releases.                                                                                                                                               |

> **Note:** `tag` and `untag` are disambiguated by argument count: 2 positional args = space tag, 3 positional args = memory tag.

### 4.9 MCP Tools

The MCP server exposes 29 tools for agent integration:

#### Spaces (8 tools)

| Tool               | Description                              |
| ------------------ | ---------------------------------------- |
| `space_create`     | Create a new space                       |
| `space_list`       | List spaces (optionally filtered by tag) |
| `space_get`        | Get a space by name                      |
| `space_update`     | Update space description                 |
| `space_rename`     | Rename a space                           |
| `space_delete`     | Delete a space                           |
| `space_tag_add`    | Add a tag to a space                     |
| `space_tag_remove` | Remove a tag from a space                |

#### Memories (11 tools)

| Tool                | Description                                     |
| ------------------- | ----------------------------------------------- |
| `memory_add`        | Add a memory to a space                         |
| `memory_get`        | Get a memory by space/name                      |
| `memory_get_by_id`  | Get a memory by ID                              |
| `memory_list`       | List memories in a space                        |
| `memory_query`      | Query memories by metadata/date with pagination |
| `memory_update`     | Update memory name/content                      |
| `memory_delete`     | Delete a memory                                 |
| `memory_read`       | Read + record access (auto-promote)             |
| `memory_tag_add`    | Add a tag to a memory                           |
| `memory_tag_remove` | Remove a tag from a memory                      |
| `memory_tags_list`  | List all tags                                   |

#### Tiers (4 tools)

| Tool             | Description                 |
| ---------------- | --------------------------- |
| `memory_promote` | Promote memory one tier up  |
| `memory_demote`  | Demote memory one tier down |
| `memory_pin`     | Pin a memory                |
| `memory_unpin`   | Unpin a memory              |

#### Links (3 tools)

| Tool          | Description                    |
| ------------- | ------------------------------ |
| `link_create` | Create a link between memories |
| `link_delete` | Delete a link                  |
| `links_list`  | List links for a memory        |

#### Checkpoint (4 tools)

| Tool                  | Description                                         |
| --------------------- | --------------------------------------------------- |
| `checkpoint_set`      | Create or update a checkpoint in `<space>:sessions` |
| `checkpoint_complete` | Mark a checkpoint completed                         |
| `checkpoint_recover`  | Recover latest active checkpoint                    |
| `checkpoint_list`     | List checkpoints for a space                        |

#### Search & Status (2 tools)

| Tool     | Description                      |
| -------- | -------------------------------- |
| `search` | Full-text search across memories |
| `status` | Get storage status               |

### 4.10 Mind Memory Protocol

When using mind via MCP, follow these conventions:

**Tags with prefixes:**

- `type:project` — project space
- `type:user` — user preferences
- `type:config` — global configuration
- `type:learning` — learned knowledge
- `type:session` — session summaries
- `cat:decision` — architectural decision
- `cat:bugfix` — bug fix
- `cat:pattern` — established pattern
- `cat:discovery` — technical discovery
- `cat:preference` — user preference
- `cat:config` — configuration

**Space hierarchy (USE REPO NAME):**

> **IMPORTANT**: For software projects, use the actual repository/directory name as the space name (e.g., `projects/mind`, `projects/arcana-web`). This makes your memories discoverable by future agents.

- `projects/<name>` — one space per project
- `user/preferences` — global user preferences
- `user/patterns` — user patterns
- `global/config` — cross-project config
- `sessions/<project>` — session summaries

**Tier usage:**

- T1 (hot) — critical active info
- T2 (warm) — default for new memories
- T3 (cold) — reference info
- T4 (frozen) — archive (only via search)

---

## 5. Keeping this document updated

**If you are an AI agent or a maintainer modifying this repo, you must keep AGENTS.md in sync with the code.**

**Changelog policy (mandatory):**

- Every non-trivial change (features, behavior changes, architecture changes, bug fixes) must be added to `CHANGELOG.md` under `## [Unreleased]`.
- Release commands (`make release-patch`, `make release-minor`, `make release-major`) require unreleased changelog entries and promote `Unreleased` to a versioned section.
- `make release-simulate TYPE=patch|minor|major` must show what would happen without modifying files/tags/releases.

- **Changes to the `mind` script or completion:** Update [§ 1](#1-project-overview), [§ 2.1](#21-high-level-flow), [§ 2.2](#22-main-modules-and-responsibilities), and [§ 4.2](#42-running-the-cli).
- **Changes to the web app or Docker:** Update [§ 1](#1-project-overview), [§ 2.2](#22-main-modules-and-responsibilities), [§ 3](#3-technical-considerations), and [§ 4.3](#43-web-app).
- **New or removed commands:** Update [§ 4.6 Commands](#46-cli-commands) and, if the architecture changes, [§ 2.1](#21-high-level-flow) / [§ 2.2](#22-main-modules-and-responsibilities).
- **New modules or major refactors:** Update [§ 2.2 Main modules](#22-main-modules-and-responsibilities) and [§ 2.1](#21-high-level-flow).
- **Config or storage changes:** Update [§ 2.3 Data model](#23-data-model), [§ 3](#3-technical-considerations), and [§ 4](#4-usage).
- **New dependencies or runtime requirements:** Update [§ 1](#1-project-overview) and [§ 3](#3-technical-considerations).
- **New or removed test utilities:** Update [§ 3](#3-technical-considerations) (Testing).
- **Schema changes:** Update [§ 2.4 SQLite schema tables](#24-sqlite-schema-tables).

After editing AGENTS.md, re-read the sections you changed to ensure they stay accurate and consistent with the rest of the document.

Before marking work done, use this checklist:

- [ ] Updated `AGENTS.md` if architecture/commands/config changed
- [ ] Updated `CHANGELOG.md` under `## [Unreleased]` for significant changes
- [ ] Updated `README.md` if user-facing behavior/install/update/release flow changed
