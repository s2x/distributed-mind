# AGENTS.md — Project guide for AI agents and maintainers

This document describes the **mind** project: its architecture, behavior, technical choices, and how to use it. It is intended for AI agents and human maintainers. **Agents that modify this codebase must keep this file updated** when they change architecture, add commands, change config, or alter behavior (see [Keeping this document updated](#keeping-this-document-updated)).

---

## 1. Project overview

**mind** is a CLI tool for persistent long-term memory — tracking thoughts, ideas, tasks, and knowledge. Data is organized into named **spaces**, each containing **memories** with full-text search, tags, links, and a 3-tier access-frequency system.

- **Runtime:** [Bun](https://bun.sh/)
- **Language:** TypeScript (strict mode, ESNext)
- **Entry point:** the **`mind`** Bash script at project root; invokes `cli/src/mind.ts`. Supports `--complete` flag to delegate to `cli/src/complete.ts` (not yet implemented).
- **Persistence:** SQLite database at `data/mind.db` (path configurable via `MIND_DATA_DIR` env var). The legacy `brain.json` is supported as a migration source via `mind import`.
- **Layout:** **`cli/`** contains all CLI code and tests. **`web/`** contains the web server and frontend (Dockerized, `restart: unless-stopped` in docker-compose).

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
    ArgParser (match command shape + flags) → command-executor (dispatch + business logic)
         ↓
    MindStore (SQLite) + Logger (stdout/stderr)
```

- **Entry:** `cli/src/mind.ts` ensures `data/` exists, creates a `MindStore` via `createSqliteStore(CONFIG.dbPath)`, wires a `Logger`, calls `executeCommand`. Errors are caught, logged to stderr, and the process exits with code 1. The store is closed in a `finally` block.
- **Commands:** Defined and dispatched in `cli/src/command-executor.ts` using `ArgParser` instances. Each command has a **shape** (positional params + optional flags) and a help description.
- **Storage:** All persistent data goes through the `MindStore` interface (defined in `cli/src/store/mind-store.ts`), implemented by `createSqliteStore` (`cli/src/store/sqlite-store.ts`). Uses bun's native `bun:sqlite`.
- **FTS:** Full-text search uses SQLite's FTS5 with a porter tokenizer. FTS is synced **manually** (bun:sqlite has a bug with content-sync triggers — see [§ 3](#3-technical-considerations)).
- **Output:** All user-facing messages go through the `Logger` interface (`cli/src/logger.ts`), so tests can swap in a mock logger.
- **Web:** The **`web/`** app serves a frontend that reads/writes the brain via a REST API. Run via `web/server.ts` (Bun). Dockerized.

### 2.2 Main modules and responsibilities

| Module | Path | Responsibility |
|--------|------|----------------|
| Entry script | `mind` (Bash) | Resolve repo root, dispatch to `cli/src/mind.ts` (or `cli/src/complete.ts` if `--complete`). |
| Entry module | `cli/src/mind.ts` | Ensure data dir, create store, wire logger, call executor, handle top-level errors. |
| Command executor | `cli/src/command-executor.ts` | Define command shapes + flags (via `ArgParser`), match args, run command logic. |
| Arg parser | `cli/src/arg-parser.ts` | Match CLI args to a shape (positional `<param>`, aliases `a\|b`, `--flag value`), extract params + flags, render help. |
| MindStore interface | `cli/src/store/mind-store.ts` | Abstract interface for all data operations. |
| SQLite store | `cli/src/store/sqlite-store.ts` | Full `MindStore` implementation using `bun:sqlite`. Handles tiers, tags, links, FTS, tidy, gc, import. |
| Schema | `cli/src/store/schema.ts` | SQLite schema (tables, indexes, FTS5 table). No triggers (see §3). `initializeDatabase()` function. |
| Config | `cli/src/config.ts` | `CONFIG.dataDir`, `CONFIG.dbPath`, `CONFIG.legacyJsonPath`. Respects `MIND_DATA_DIR` env var. |
| Types | `cli/src/types.ts` | All domain types: `Space`, `Memory`, `Link`, `Tier`, `SearchResult`, `TidyResult`, `GcResult`, `Stats`, `LegacyBrain`, etc. |
| Logger | `cli/src/logger.ts` | `logInfo` / `logError`; default implementation uses console. |
| Web server | `web/server.ts` | Bun HTTP server: REST API + static files from `web/public/`. Uses `MIND_DATA_DIR` or `/data` in Docker. |
| Web frontend | `web/public/*` | SPA for browsing and editing spaces and memories. |

### 2.3 Data model

- **Brain:** A SQLite database (`mind.db`) at `data/` in the repo root (or `MIND_DATA_DIR`).
- **Space:** `{ name: string, description: string, tags: string[], created_at, updated_at }`. Identified by name (primary key).
- **Memory:** `{ id: number, space_name: string, name: string, content: string, tier: 1|2|3, pinned: boolean, access_count: number, last_accessed_at: string|null, tags: string[], created_at, updated_at }`. Identified by `(space_name, name)`.
- **Tier system:**
  - 🔴 **T1 (hot)** — frequently accessed
  - 🟡 **T2 (warm)** — default for new memories
  - 🔵 **T3 (cold)** — rarely used, candidates for cleanup
  - Auto-promotion on CLI `read`: T3→T2 immediately; T2→T1 after 5 accesses within 7 days.
  - Auto-demotion via `mind tidy`: T1→T2 after 14 days without access; T2→T3 after 30 days.
  - **Pinned memories are immune to auto-demotion.**
- **Link:** Directional edge between two memories with a label (default: `"related"`). Stored as `(source_id, target_id, label)`.
- **Tags:** Both spaces and memories can have multiple string tags (lowercase, trimmed).
- **FTS:** `memories_fts` virtual FTS5 table, synced manually on add/update/delete. Supports fuzzy matching via porter tokenizer.

### 2.4 SQLite schema tables

| Table | Key columns | Notes |
|-------|------------|-------|
| `meta` | `key`, `value` | Tracks `schema_version`. |
| `spaces` | `name` (PK), `description`, timestamps | |
| `space_tags` | `space_name` (FK), `tag` | Cascades on space rename/delete. |
| `memories` | `id` (PK), `space_name` (FK), `name`, `content`, `tier`, `pinned`, `access_count`, `last_accessed_at`, timestamps | UNIQUE on `(space_name, name)`. Cascades on space delete/rename. |
| `memory_tags` | `memory_id` (FK), `tag` | Cascades on memory delete. |
| `links` | `source_id` (FK), `target_id` (FK), `label` | No self-links. Cascades on memory delete. |
| `memories_fts` | FTS5 virtual table: `name`, `content` | Synced manually (no triggers). |

---

## 3. Technical considerations

- **Bun:** The project is run and tested with Bun. Use `bun run`, `bun test`, and Bun's built-in TypeScript + SQLite support. No separate compile step.
- **bun:sqlite FTS5 bug:** bun:sqlite (v1.2.10) cannot handle FTS5 `content=table` sync triggers — any UPDATE or DELETE on the source table errors with "N values for M columns". **Workaround:** `memories_fts` is a standalone FTS5 table (no `content=` option, no triggers). FTS is synced manually in `sqlite-store.ts` via `ftsInsert`, `ftsUpdate`, `ftsDelete` helpers called from `addMemory`, `updateMemory`, `deleteMemory`, `deleteMemoryByName`, `deleteSpace`, `importFromJson`, and `gc`.
- **Styling:** Terminal output uses `bun-style` for bold, colors, etc. Tests assert on the styled strings.
- **Config / storage path:** `cli/src/config.ts` resolves `CONFIG.dbPath` from `MIND_DATA_DIR` env var (defaults to `data/` at repo root). The web server uses `MIND_DATA_DIR` (or `/data` in Docker). `data/` is in `.gitignore`.
- **Testing:** CLI tests live in `cli/test/`, use `bun:test`, and rely on:
  - **`test-store.ts`** (`cli/test/mocks/test-store.ts`): creates a temporary SQLite DB in `/tmp/` per test instance; returns `{ store, cleanup }`.
  - **`mocked-logger.ts`** (`cli/test/mocks/mocked-logger.ts`): captures `logInfo`/`logError` for assertions.
  - Test files: `cli/test/mind-store.spec.ts` (store-level) and `cli/test/command-executor.spec.ts` (CLI-level).
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

### 4.3 Web app

- **Local:** `cd web && bun run start` (or `make web-dev`). Open http://localhost:3000. Uses `data/` at repo root unless `MIND_DATA_DIR` is set.
- **Docker:** From repo root: `docker compose up -d`. Web at http://localhost:3000; data in `./data/` on the host (or `BRAIN_DATA_DIR`). Service has `restart: unless-stopped`.

### 4.4 Running tests

```bash
bun test cli/test
```

### 4.5 Migrating from legacy brain.json

```bash
./mind import
```

Reads `data/brain.json` (or `$MIND_DATA_DIR/brain.json`) and imports all spaces and memories into SQLite at tier 2.

### 4.6 CLI commands

| Intent | Command | Aliases | Params | Flags | Description |
|--------|---------|---------|--------|-------|-------------|
| Help | `help` | `h` | — | — | List all commands. |
| Create space | `create` | `c` | `<space>` `<description>` | `--tags` | Create a new space (comma-sep tags). |
| List spaces | `list` | `ls`, `l` | — | `--tag` | List all spaces (optionally filtered). |
| List memories | `list` | `ls`, `l` | `<space>` | `--tier`, `--tag` | List memories in a space. |
| Delete space | `delete` | `d` | `<space>` | — | Delete a space and all its memories. |
| Rename space | `rename` | `rn` | `<old>` `<new>` | — | Rename a space. |
| Describe space | `describe` | `ds` | `<space>` `<description>` | — | Change a space's description. |
| Tag space | `tag` | `t` | `<space>` `<tag>` | — | Add a tag to a space. |
| Untag space | `untag` | — | `<space>` `<tag>` | — | Remove a tag from a space. |
| Add memory | `add` | `a` | `<space>` `<name>` `<content>` | `--tags`, `--tier` | Add a memory. |
| Read memory | `read` | `r` | `<space>` `<name>` | — | Print a memory (bumps access + auto-promote). |
| Edit memory | `edit` | `e` | `<space>` `<name>` `<content>` | — | Update a memory's content. |
| Remove memory | `remove` | `rm` | `<space>` `<name>` | — | Remove a memory by name. |
| Tag memory | `tag` | `t` | `<space>` `<name>` `<tag>` | — | Add a tag to a memory. |
| Untag memory | `untag` | — | `<space>` `<name>` `<tag>` | — | Remove a tag from a memory. |
| Promote | `promote` | `up` | `<space>` `<name>` | — | Move memory one tier up (T3→T2, T2→T1). |
| Demote | `demote` | `down` | `<space>` `<name>` | — | Move memory one tier down (T1→T2, T2→T3). |
| Pin | `pin` | — | `<space>` `<name>` | — | Pin a memory (immune to auto-demotion). |
| Unpin | `unpin` | — | `<space>` `<name>` | — | Unpin a memory. |
| Link | `link` | — | `<source>` `<target>` | `--label` | Link two memories (`space/name` format). |
| Unlink | `unlink` | — | `<source>` `<target>` | — | Remove a link between memories. |
| Show links | `links` | — | `<space>` `<name>` | — | Show all links for a memory. |
| Search | `search` | `s` | `<query>` | `--space`, `--tag`, `--tier`, `--detail` | Full-text search across memories. Default output: names only. `--detail` adds content preview. Use `term*` for prefix match. |
| Tidy (global) | `tidy` | — | — | — | Auto-demote stale memories globally. |
| Tidy (space) | `tidy` | — | `<space>` | — | Auto-demote stale memories in a space. |
| GC | `gc` | — | — | `--days` | Remove old tier-3 memories (default: 90 days). |
| Stats (global) | `stats` | — | — | — | Show usage statistics. |
| Stats (space) | `stats` | — | `<space>` | — | Show stats for a specific space. |
| Guide | `guide` | `g` | — | — | Show usage guide (human mode). |
| Guide (mode) | `guide` | `g` | `<mode>` | — | Show guide (`agent` or `human`). |
| Import | `import` | — | — | — | Import legacy `brain.json` into SQLite. |

> **Note:** `tag` and `untag` are disambiguated by argument count: 2 positional args = space tag, 3 positional args = memory tag.

---

## 5. Keeping this document updated

**If you are an AI agent or a maintainer modifying this repo, you must keep AGENTS.md in sync with the code.**

- **Changes to the `mind` script or completion:** Update [§ 1](#1-project-overview), [§ 2.1](#21-high-level-flow), [§ 2.2](#22-main-modules-and-responsibilities), and [§ 4.2](#42-running-the-cli).
- **Changes to the web app or Docker:** Update [§ 1](#1-project-overview), [§ 2.2](#22-main-modules-and-responsibilities), [§ 3](#3-technical-considerations), and [§ 4.3](#43-web-app).
- **New or removed commands:** Update [§ 4.6 Commands](#46-cli-commands) and, if the architecture changes, [§ 2.1](#21-high-level-flow) / [§ 2.2](#22-main-modules-and-responsibilities).
- **New modules or major refactors:** Update [§ 2.2 Main modules](#22-main-modules-and-responsibilities) and [§ 2.1](#21-high-level-flow).
- **Config or storage changes:** Update [§ 2.3 Data model](#23-data-model), [§ 3](#3-technical-considerations), and [§ 4](#4-usage).
- **New dependencies or runtime requirements:** Update [§ 1](#1-project-overview) and [§ 3](#3-technical-considerations).
- **New or removed test utilities:** Update [§ 3](#3-technical-considerations) (Testing).
- **Schema changes:** Update [§ 2.4 SQLite schema tables](#24-sqlite-schema-tables).

After editing AGENTS.md, re-read the sections you changed to ensure they stay accurate and consistent with the rest of the document.
