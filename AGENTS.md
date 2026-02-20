# AGENTS.md — Project guide for AI agents and maintainers

This document describes the **mind** project: its architecture, behavior, technical choices, and how to use it. It is intended for AI agents and human maintainers. **Agents that modify this codebase must keep this file updated** when they change architecture, add commands, change config, or alter behavior (see [Keeping this document updated](#keeping-this-document-updated)).

---

## 1. Project overview

**mind** is a small **CLI tool** for tracking thoughts, ideas, and tasks. It stores data in a single JSON file (the “brain”) and organizes content in named **spaces**, each with a description and an ordered list of text **memories**.

- **Runtime:** [Bun](https://bun.sh/)
- **Language:** TypeScript (strict mode, ESNext)
- **Entry point:** the **`mind`** script (Bash) at project root; it invokes `cli/src/mind.ts` with the script arguments. Optionally supports `--complete` for shell completion (delegates to `cli/src/complete.ts` when present).
- **Persistence:** `brain.json` at project root (path configurable in `cli/src/config.ts`). The **web** app uses the same JSON format; when run via Docker it stores the brain in a volume at `/data/brain.json`.
- **Layout:** **`cli/`** contains all CLI code and tests. **`web/`** contains the web server and frontend for viewing/editing the brain (markdown editor, Dockerized, `restart: unless-stopped` in docker-compose).

---

## 2. Architecture

### 2.1 High-level flow

```
User → ./mind <command> [args]   (or: mind when installed/linked)
         ↓
    mind (Bash script at repo root)
         ↓
    bun run cli/src/mind.ts "$@"
         ↓
    executeCommand(args, brainProvider, logger)
         ↓
    ArgParser (match command shape) → command-executor (dispatch + business logic)
         ↓
    BrainProvider (read/write brain) + Logger (stdout/stderr)
```

- **Entry:** The **`mind`** Bash script (project root) runs `bun run cli/src/mind.ts "$@"`. If the first argument is `--complete`, it runs `cli/src/complete.ts` with the remaining args instead (for shell completion). `cli/src/mind.ts` then reads `process.argv`, wires a `BrainProvider` and a `Logger`, and calls `executeCommand`. Errors are caught, logged, and the process exits with code 1.
- **Commands:** Defined and dispatched in `cli/src/command-executor.ts` using `ArgParser` instances. Each command has a **shape** (e.g. `['create|c', '<space>', '<description>']`) and a description for help.
- **Storage:** All persistent data goes through the `BrainProvider` interface (implemented in `cli/src/brain-provider.ts`), which reads/writes the brain (default: `brain.json` at repo root).
- **Output:** All user-facing messages go through the `Logger` interface (implemented in `cli/src/logger.ts`), so tests can swap in a mock logger.
- **Web:** The **`web/`** app serves a SPA that reads/writes the same brain via `GET/PUT /api/brain`. It is run by `web/server.ts` (Bun), serves static files from `web/public/`, and is Dockerized with `restart: unless-stopped` in `docker-compose.yml`.

### 2.2 Main modules and responsibilities

| Module | Path | Responsibility |
|--------|------|----------------|
| Entry script | `mind` (Bash) | Resolve repo root, dispatch to `cli/src/mind.ts` or (if `--complete`) to `cli/src/complete.ts`. |
| Entry module | `cli/src/mind.ts` | Parse argv, inject BrainProvider + Logger, call executor, handle top-level errors. |
| Command executor | `cli/src/command-executor.ts` | Define command shapes (via `ArgParser`), match args, run command logic, use BrainProvider and Logger. |
| Arg parser | `cli/src/arg-parser.ts` | Match CLI args to a shape (including `<param>` placeholders and `a|b` aliases), extract params, render help. |
| Brain provider | `cli/src/brain-provider.ts` | Load/save brain JSON, create/read spaces; concrete implementation uses `config.storagePath`. |
| Config | `cli/src/config.ts` | Central config (e.g. `storagePath` for the brain file). |
| Types | `cli/src/types.ts` | `Brain` and `Space` types. |
| Logger | `cli/src/logger.ts` | `logInfo` / `logError`; default implementation uses console. |
| Web server | `web/server.ts` | Bun server: GET/PUT `/api/brain`, static files from `web/public/`. Uses `BRAIN_PATH` (default repo `brain.json` or `/data/brain.json` in Docker). |
| Web frontend | `web/public/*` | SPA: list spaces, edit description and memories (name + description, markdown editor), create/rename/delete spaces, add/remove/reorder memories. |

### 2.3 Data model

- **Brain:** A single object: keys = space names, values = `Space`.
- **Space:** `{ description: string, memories: Memory[] }`. Memories are ordered (index 1-based in CLI).
- **Memory:** `{ name: string, description: string }`. Each memory has a name and a description (e.g. Markdown).
- Stored as pretty-printed JSON in one file (by default `brain.json` next to the project root, see `config.ts`).

---

## 3. Technical considerations

- **Bun:** The project is run and tested with Bun. Use `bun run`, `bun test`, and Bun’s TypeScript support. No separate compile step is required for running.
- **Styling:** Terminal output uses `bun-style` for bold, colors, etc. Help text and success/error messages are styled; tests assert on the styled strings.
- **Storage path:** `cli/src/config.ts` sets `storagePath` (repo root `brain.json`). The web server uses `BRAIN_PATH` (env, or default repo root when run locally, `/data/brain.json` in Docker). `brain.json` is in `.gitignore` so user data is not committed.
- **Testing:** CLI tests live in `cli/test/`, use `bun:test`, and rely on:
  - **MockedBrainProvider** (`cli/test/mocks/mocked-brain-provider.ts`): in-memory brain per test instance.
  - **mockedLogger** (`cli/test/mocks/mocked-logger.ts`): captures `logInfo`/`logError` for assertions.
- **Docker:** `web/Dockerfile` builds the web app; `docker-compose.yml` at repo root runs it with volume `mind-data` at `/data` and `restart: unless-stopped`.
- **Dependencies:** Production: `bun-style`. Dev: `@types/bun`. Peer: `typescript ^5`.

---

## 4. Usage

### 4.1 Setup

```bash
bun install
```

### 4.2 Running the CLI

From the project root, run the **`mind`** Bash script (make it executable if needed: `chmod +x mind`):

```bash
./mind <command> [args]
```

Example: `./mind help`, `./mind create my-space "Description"`.

If `mind` is on `PATH` (e.g. symlink or installed as a bin), you can run:

```bash
mind <command> [args]
```

The script forwards all arguments to `bun run cli/src/mind.ts`. For shell completion it supports `--complete` and delegates to `cli/src/complete.ts` when that module exists.

### 4.3 Web app

- **Local:** `cd web && bun run start` (or `bun run web/server.ts` from repo root). Open http://localhost:3000. Uses `brain.json` at repo root unless `BRAIN_PATH` is set.
- **Docker:** From repo root run `docker compose up -d`. Web is at http://localhost:3000; brain is stored in volume `mind-data`. The service has `restart: unless-stopped`.

### 4.4 CLI commands (as of this writing)

| Intent | Aliases | Params | Description |
|--------|---------|--------|-------------|
| Help | `help`, `h` | — | List all commands and their usage. |
| Create space | `create`, `c` | `<space>`, `<description>` | Create a new space. |
| List spaces | `list`, `ls`, `l` | — | List all spaces and their descriptions. |
| List memories | `list`, `ls`, `l` | `<space>` | List memory names of a space. |
| Read memory | `read`, `r` | `<space>`, `<name>` | Print a space’s memory by name (name + description). |
| Rename space | `rename`, `rn` | `<old>`, `<new>` | Rename a space. |
| Add memory | `add`, `a` | `<space>`, `<name>`, `<description>` | Add a memory (name + description) to a space. |
| Remove memory | `remove`, `rm` | `<space>`, `<index>` | Remove memory at 1-based index. |
| Delete space | `delete`, `d` | `<space>` | Delete a space and its memories. |
| Describe space | `describe`, `ds` | `<space>`, `<description>` | Change a space’s description. |
| Reorder memories | `reorder`, `ro` | `<space>`, `<fromIndex>`, `<toIndex>` | Move memory; `toIndex` 0 = top, -1 = bottom. |

Unknown or invalid commands/spaces/indices produce error messages and non-zero exit when run via `mind.ts`.

---

## 5. Keeping this document updated

**If you are an AI agent or a maintainer modifying this repo, you must keep AGENTS.md in sync with the code.**

- **Changes to the `mind` script or completion:** Update [§ 1](#1-project-overview), [§ 2.1](#21-high-level-flow), [§ 2.2](#22-main-modules-and-responsibilities), and [§ 4.2](#42-running-the-cli). If `cli/src/complete.ts` is added or removed, document it.
- **Changes to the web app or Docker:** Update [§ 1](#1-project-overview), [§ 2.2](#22-main-modules-and-responsibilities), [§ 3](#3-technical-considerations), and [§ 4.3](#43-web-app).
- **New or removed commands:** Update [§ 4.3 Commands](#43-commands-as-of-this-writing) and, if the architecture changes, [§ 2.1](#21-high-level-flow) / [§ 2.2](#22-main-modules-and-responsibilities).
- **New modules or major refactors:** Update [§ 2.2 Main modules](#22-main-modules-and-responsibilities) and any flow description in [§ 2.1](#21-high-level-flow).
- **Config or storage changes:** Update [§ 2.3 Data model](#23-data-model), [§ 3](#3-technical-considerations) (e.g. storage path), and [§ 4](#4-usage) if usage changes.
- **New dependencies or runtime requirements:** Update [§ 1](#1-project-overview) and [§ 3](#3-technical-considerations).
- **New or removed test utilities:** Update [§ 3](#3-technical-considerations) (Testing) and, if they affect architecture, [§ 2](#2-architecture).

After editing AGENTS.md, re-read the sections you changed to ensure they stay accurate and consistent with the rest of the document.
