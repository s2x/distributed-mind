# mind

**Capture once. Remember forever.**

mind is a persistent memory system for developers and AI agents.

It helps you store what matters (decisions, bugfixes, notes, patterns, tasks), organize it, and retrieve it instantly across sessions.

## What Is mind?

mind is a Bun + TypeScript project that provides:

- a powerful **CLI** for managing long-term memory,
- an **MCP server** for AI agent integration,
- and a **web interface + API** for browsing and editing memory visually.

All data is stored in **SQLite** (`mind.db`) with full-text search (FTS5), tags, links between memories, and a 4-tier memory model.

## How It Works (High Level)

1. You write memories into named **spaces** (`projects/app`, `user/preferences`, etc).
2. mind stores them in SQLite with tags and metadata.
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

## Installation

### One-line installer (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/Gentleman-Programming/mind/main/scripts/install.sh | bash
```

This installs mind to user-local paths (no sudo):

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
git clone https://github.com/Gentleman-Programming/mind.git
cd mind
bun install
```

## Quick Start

```bash
./mind create projects/mind "Mind project memory"
./mind add projects/mind architecture "CLI uses command registry + atomic command modules"
./mind search architecture
```

For the full command list:

```bash
./mind help
```

## Usage

### CLI

```bash
./mind help
./mind create <space> "description"
./mind update <space> --hidden
./mind list --hidden
./mind add <space> <name> "content"
./mind list <space>
./mind read <space> <name>
./mind checkpoint set <space> "goal" "pending"
./mind checkpoint recover <space>
./mind checkpoint complete <space> <id> "what was done"
./mind checkpoint list <space> --status active
./mind search "query"
./mind query --space <space> --from 2026-01-01 --to 2026-12-31 --limit 20 --offset 0
./mind update --check
./mind update
```

### Web Server

```bash
./mind serve start
./mind serve start --port 8080
./mind serve start --detached
./mind serve stop
```

### MCP Server

```bash
./mind mcp                           # stdio mode
./mind mcp start --http              # HTTP mode
./mind mcp start --http --detached   # HTTP background
./mind mcp stop
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

Checkpoint MCP tools are also available for session continuity:

- `checkpoint_set`
- `checkpoint_complete`
- `checkpoint_recover`
- `checkpoint_list`

### Agent Setup

```bash
./mind setup claude-code
./mind setup opencode
./mind setup cursor
./mind setup windsurf
./mind setup codex
./mind setup gemini-cli
```

Check server process status:

```bash
./mind server-status
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
./mind import
```

## Project Structure

```text
cli/src/
  cli/        # CLI parser, command registry, setup/runtime helpers
  mcp/        # MCP command + MCP server + tools
  api/        # HTTP command, router, route modules, API server
  helpers/    # logger, tags, format, rag helpers
  store/      # SQLite schema + MindStore implementation
  mind.ts     # main entrypoint used by ./mind

web/public/   # frontend assets served by API server
```

## Testing

Run unit tests:

```bash
bun test cli/test
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
