# 🧠 Mind

_**Capture once. Remember forever.**_

Mind is a persistent memory system for developers and AI agents.

It helps you store what matters (decisions, bugfixes, notes, patterns, tasks), organize it, and retrieve it instantly across sessions.

## What Is Mind?

Mind is a Bun + TypeScript project that provides:

- a powerful **CLI** for managing long-term memory,
- an **MCP server** for AI agent integration,
- and a **web interface + API** for browsing and editing memory visually.

All data is stored in **SQLite** (`mind.db`) with full-text search (FTS5), tags, links between memories, and a 4-tier memory model.

## How It Works (High Level)

1. You write memories into named **spaces** (`projects/app`, `user/preferences`, etc).
2. Mind stores them in SQLite with tags and metadata.
3. You retrieve them with fast full-text search and filters.
4. Memories are organized by tier (hot/warm/cold/frozen) and can auto-promote based on access.
5. AI agents can use the same memory via MCP tools.

## Key Features

- **Spaces + Memories**: structured memory namespaces.
- **4-tier memory model**: T1 hot, T2 warm, T3 cold, T4 frozen.
- **Tags + Links**: classify and connect related memories.
- **Full-text search (FTS5)** across all memories (including archive tier).
- **Optional semantic search (RAG)** with OpenAI embeddings.
- **MCP integration** for agent workflows.
- **Web API + UI** for visual memory management.
- **Neural Map (MVP)** per space: read-only graph with tier rings, pan/zoom, and on-demand detail fetch.

## Installation

### One-line installer (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/GabrielMartinMoran/mind/main/scripts/install.sh | bash
```

This installs Mind to user-local paths (no sudo):

- app: `~/.local/share/mind`
- launcher: `~/.local/bin/mind`

Then run:

```bash
mind help
```

Local alternative (same installer, no curl pipe):

```bash
make install-local
```

### Requirements

- [Bun](https://bun.sh/) 1.2+

### Install

```bash
git clone https://github.com/GabrielMartinMoran/mind.git
cd mind
bun install
```

## Quick Start

```bash
mind create projects/mind "Mind project memory"
mind add projects/mind architecture "CLI uses command registry + atomic command modules"
mind search architecture
```

For the full command list:

```bash
mind help
```

## Usage

### CLI

```bash
mind help
mind create <space> "description"
mind update <space> --hidden
mind list --hidden
mind add <space> <name> "content"
mind list <space>
mind read <space> <name>
mind checkpoint set <space> "goal" "pending"
mind checkpoint recover <space> --format text|md|json --agent opencode
mind checkpoint complete <space> <id> "what was done"
mind checkpoint list <space> --status active
mind search "query"
mind query --space <space> --from 2026-01-01 --to 2026-12-31 --limit 20 --offset 0
mind update --check
mind update
```

### Web Server

```bash
mind serve start
mind serve start --port 8080
mind serve start --detached
mind serve stop
```

### Neural Map (Web MVP)

In the web UI, each space now has a **Neural Map** view:

- read-only graph per space
- concentric rings by tier (**T1..T4**)
- pan + zoom controls
- node prominence based on connectivity (link degree)
- click a node to fetch/show memory details via existing memory detail endpoint

The SPA uses URL-driven client routing for reliable deep-linking and reload recovery:

- `/` → spaces home
- `/spaces/{encodedSpace}`
- `?view=list|map`
- optional `?memory={encodedMemory}`

Navigation updates the URL (space open, list/map switch, memory selection), reload restores state, and browser back/forward is supported via History API.

Graph API endpoint used by the SPA:

- `GET /api/spaces/:space/graph?limit=<n>`
- returns minimal payload per node: `id`, `name`, `tier`, `links_to:number[]`, `linked_by:number[]`
- includes T4 by default
- includes truncation metadata (`total_nodes`, `returned_nodes`, `requested_limit`, `applied_limit`, `max_limit`, `truncated`)

### MCP Server

```bash
mind mcp                           # stdio mode
mind mcp start --http              # HTTP mode
mind mcp start --http --detached   # HTTP background
mind mcp stop
```

Example MCP tool usage (for agents):

```json
{
    "name": "memory_query",
    "arguments": {
        "space": "Credentials",
        "from": "2026-03-01",
        "to": "2026-03-31",
        "limit": 25,
        "offset": 0
    }
}
```

`memory_query` returns structured results including `items` and pagination info (`limit`, `offset`, `nextOffset`).

Memory MCP workflows also support bounded composite ergonomics while keeping atomic tools:

- `memory_add` supports optional `pinned` and `links_to_ids` (atomic all-or-nothing).
- `memory_read` returns directional linked summaries via `links_to` and `linked_by` with high-signal fields (`id`, `name`, `changed_at`, `tier`, `tags`, `pinned`).
- `memory_patch` applies bounded composite updates for one memory (`name/content`, `pinned`, tier transition, tag add/remove, link add/remove) with atomic all-or-nothing behavior.

Checkpoint MCP tools are also available for session continuity:

- `checkpoint_set`
- `checkpoint_complete`
- `checkpoint_recover`
- `checkpoint_list`

`checkpoint_recover` now supports `format` (`text|md|json`) and optional `agent` profile selection, and returns a Recovery Pack payload with checkpoint state, recent context hits, and capability-aware fallback guidance.

### Agent Setup

```bash
mind setup claude-code
mind setup opencode
mind setup cursor
mind setup windsurf
mind setup codex
mind setup gemini-cli
```

> Note: **OpenClaw** is currently **Experimental** (status declaration only). There is no `mind setup openclaw` wiring yet.

`mind setup` (without agent) now prints a capability matrix per integration using a 3-level model:

- **L1**: MCP transport wiring
- **L2**: instruction/protocol injection
- **L3**: hooks/session/compaction automation

Each level is explicitly marked as `supported`, `unsupported`, or `unverified` with evidence/fallback notes.
If a capability is not implemented, setup output is explicit (no silent skip).

#### Agent status matrix

Status labels used here:

- **Complete**: L1/L2/L3 are all `supported`
- **Partial**: at least one level is `unsupported` or `unverified`
- **Experimental**: declaration exists but integration is explicitly unstable/unverified
- **Roadmap**: planned declaration only, no adapter wiring

| **Agent**   | **Status**   | **Capability reality**                                                                                             |
| :---------- | :----------- | :----------------------------------------------------------------------------------------------------------------- |
| OpenCode    | Complete     | L1 `supported`, L2 `supported`, L3 `supported`                                                                     |
| Claude Code | Complete     | L1 `supported`, L2 `supported`, L3 `supported` (opt-in hooks)                                                      |
| Codex       | Partial      | L1 `supported`, L2 `supported`, L3 `unsupported`                                                                   |
| Cursor      | Partial      | L1 `supported`, L2 `unverified`, L3 `supported`                                                                    |
| Windsurf    | Partial      | L1 `supported`, L2 `unsupported`, L3 `unsupported`                                                                 |
| Gemini CLI  | Partial      | L1 `supported`, L2 `unsupported`, L3 `unsupported`                                                                 |
| OpenClaw    | Experimental | L1 `unverified`, L2 `unsupported`, L3 `unsupported` (status-only declaration; safe fallback only; no setup wiring) |
| VSCode      | Roadmap      | L1 `unverified`, L2 `unsupported`, L3 `unsupported`                                                                |
| Antigravity | Roadmap      | L1 `unverified`, L2 `unsupported`, L3 `unsupported`                                                                |
| Kiro        | Roadmap      | L1 `unverified`, L2 `unsupported`, L3 `unsupported`                                                                |

Rollout policy:

- Wave 1 priority agents: **OpenCode, Claude Code, Gemini CLI, Cursor**
- Claude Code now includes managed **L2 protocol injection** by writing `~/.claude/instructions/mind-memory-protocol.md` and maintaining a managed block in `~/.claude/CLAUDE.md`
- Claude Code **L3 hooks automation is opt-in and non-blocking** (default off). Enable with `MIND_SETUP_CLAUDE_ENABLE_HOOKS=true` before running setup.
- Cursor **L2** remains intentionally **unverified** (no verified global user-rules injection path)
- Cursor **L3** is implemented with global hooks wiring (`~/.cursor/hooks.json` + managed hook script)
- Existing integrations outside Wave 1 remain wired in the same capability model with explicit status
- OpenClaw is listed as **experimental** in capability output (non-breaking declaration, no setup wiring yet)
- Next-wave roadmap adapters remain declaration-only: **VSCode, Antigravity, Kiro** (non-breaking, no setup wiring yet)

`mind setup opencode` is idempotent and non-destructive:

- preserves unknown keys already present in `~/.config/opencode/opencode.json`
- configures `mcp.mind` as local command transport (`type: "local"`, `command: ["<path-to-mind>", "mcp"]`)
- writes/refreshes `~/.config/opencode/instructions/mind-memory-protocol.md`
- ensures that instruction file is present in OpenCode's `instructions` list
- configures prudent L3 session/compaction automation by default and non-blocking, writing `~/.config/opencode/plugins/mind-automation.js` during setup

`mind setup codex` keeps setup idempotent and writes local MCP command args in `~/.codex/config.toml`:

- `[mcp_servers.mind]`
- `command = "<path-to-mind>"`
- `args = ["mcp"]`

It also non-destructively upserts a managed Memory Protocol block in `~/.codex/AGENTS.md`.

`mind setup cursor` keeps existing MCP setup behavior and now configures global L3 continuity hooks:

- writes/updates `~/.cursor/hooks.json` with managed idempotent entries for `sessionStart`, `preCompact`, and `stop`
- writes/refreshes executable hook script `~/.cursor/hooks/mind-session-continuity.sh`
- preserves existing hook config keys/entries

Check server process status:

```bash
mind server-status
```

### Update

mind can update itself from GitHub Releases:

```bash
mind update --check                 # check if a newer release exists
mind update                         # update to latest release
mind update --version v0.1.0        # update to a specific tag
```

## Data Storage

- Default DB path: `data/mind.db`
- Override directory: `MIND_DATA_DIR=/custom/path`
- Override full DB path: `MIND_DB_PATH=/custom/path/mind.db`

Legacy migration:

```bash
mind import
```

## Project Structure

```text
cli/src/
  cli/        # CLI parser, command registry, setup/runtime helpers
  mcp/        # MCP command + MCP server + tools
  api/        # HTTP command, router, route modules, API server
  helpers/    # logger, tags, format, rag helpers
  store/      # SQLite schema + MindStore implementation
  mind.ts     # main entrypoint used by mind

web/src/      # frontend runtime modules (ESM, no build step)
web/styles/   # split CSS (tokens/base/layout/components/utilities)
web/assets/   # static assets (logo, images)
web/public/   # SPA HTML shell (index.html)
web/test/     # web-only tests
```

## Testing

Run unit tests:

```bash
bun test cli/test web/test
```

Run web-only tests:

```bash
bun test web/test
```

Run RAG integration test (requires `OPENAI_API_KEY`):

```bash
make test-rag
```

## Maintainers: Releases

Release management is handled via `Makefile`:

```bash
make help
make release-patch
make release-minor
make release-major
make release-simulate TYPE=patch
```

`release-simulate` runs a full release simulation without changing files, creating tags, or publishing a release.

## Contributing

Issues and PRs are welcome.

- Keep changes focused and documented.
- Preserve command behavior and compatibility when possible.
- Update `AGENTS.md` when architecture or command behavior changes.

## License

[MIT](./LICENSE)

For release history, see [CHANGELOG.md](./CHANGELOG.md).
