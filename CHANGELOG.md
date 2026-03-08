# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Changelog Entry Style

Use concise, user-facing bullets under `## [Unreleased]`, grouped by:

- `### Added` — new features, commands, or capabilities.
- `### Changed` — behavior or architecture changes.
- `### Fixed` — bug fixes and regressions.
- `### Removed` — removed commands, APIs, or features.

Guidelines:

- Write one change per bullet, starting with an action verb (`Added`, `Refactored`, `Fixed`, `Removed`).
- Mention affected surface area when useful (e.g. `mind update`, `cli/src/api/routes/*`).
- Focus on **what changed and why it matters**, not implementation details.
- Keep internal refactors only if they impact maintainers, contributors, or users.

Example:

- `Added \\`mind update --check\\` to verify available releases without installing.`

## [Unreleased]

### Added
- Added checkpoint system for session persistence and recovery:
    - `checkpoint set` / `cp set` - Create/update a checkpoint
    - `checkpoint complete` / `cp complete` - Mark checkpoint as completed
    - `checkpoint recover` / `cp recover` - Recover latest active checkpoint
    - `checkpoint list` / `cp list` - List all checkpoints for a space
- Added hidden spaces feature:
    - `mind update <space> --hidden` - Mark space as hidden
    - `mind update <space> --no-hidden` - Unmark space as hidden
    - `mind list --hidden` - Show hidden spaces
- Added MCP checkpoint tools: `checkpoint_set`, `checkpoint_complete`, `checkpoint_recover`, `checkpoint_list`
- Added checkpoint space organization: `<space>:sessions` for storing checkpoints
- Added regression coverage for protocol-resource wiring in setup and MCP system tools: `cli/test/setup-opencode.spec.ts` and `cli/test/system-tools.spec.ts`.

### Changed

- Added `mind update <space> --description|--hidden|--no-hidden` for explicit space updates.
- Spaces now have a `hidden` field (default: false)
- Added MCP setup, process management, and detached runtime commands.
- Added one-line installer (`scripts/install.sh`) for user-local installation.
- Added self-update command (`mind update`) from GitHub releases.
- Added maintainer release automation scripts and Make targets (`release-patch`, `release-minor`, `release-major`, `release-simulate`).
- Added `mind query` (`query|q`) to filter memories by space/tag/tier/date with pagination.
- Added API endpoint `GET /api/memories/query` for metadata/date memory queries.
- Added MCP `memory_query` tool with metadata/date filters and offset pagination (`nextOffset`).
- Changed `mind setup opencode` to be explicitly idempotent/non-destructive with deep-merge JSON behavior and managed Memory Protocol instruction injection.
- Hardened `mind setup opencode` to place the managed `~/.config/opencode/instructions/mind-memory-protocol.md` path as the first `instructions` entry (exact path, deduplicated), and updated the managed protocol text to explicitly require calling `mind_system_instructions` before tool usage.
- Refactored embedded protocol markdown into canonical files under `cli/src/resources/protocols/` and added shared loader `cli/src/helpers/markdown-resource.ts` for OpenCode setup injection and MCP `system_instructions` content.

### Changed

- Reorganized source layout into explicit domains: `cli/`, `mcp/`, `api/`, `helpers/`.
- Refactored CLI command handling into atomic modules loaded by a registry-based command executor.
- Split HTTP API into route modules plus centralized router matcher.
- Rewrote README for open-source onboarding and modern install/update workflow.
- Changed memory list/read/search/query output to use consistent changed-date display for better recency visibility.
- Changed `mind query` default page size to 25 and added inline pagination footer (`limit | offset | next offset`).
- Added semantic `changed_at` tracking for memories and switched CLI/API date displays and query date filters/order to use `changed_at` (excluding read/access and embedding updates).
- Unified date rendering in CLI memory outputs (`list`, `read`, `search --detail`, `query`) to a shared changed-date format and improved `search/query` help flag descriptions with expected values/formats.
- Changed shared memory reference rendering in CLI lists/search/query to bracketed format (`[Space] / [Memory]`) for faster visual scanning.
- Changed MCP call-tool responses to include structured payload data (when provided by tool handlers), not only text content.
- Increased Bun HTTP idle timeout defaults to reduce premature request timeouts (`MIND_MCP_IDLE_TIMEOUT` default 120s, `MIND_API_IDLE_TIMEOUT` default 30s).

### Fixed
- Fixed command wiring inconsistencies between runtime entrypoint and subcommand modules.
- Improved detached startup behavior with process liveness checks and clearer failure messages.
- Fixed MCP tools not receiving parameters: corrected Zod to JSON Schema conversion for Zod 4.x in `cli/src/mcp/server.ts`
- Added MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) to all 29 MCP tools
- Added defensive validation with clear error messages to all MCP tool handlers
- Replaced ad-hoc MCP HTTP handling with the official Streamable HTTP transport implementation (session-aware initialize/tools flow), fixing Cursor connection errors (`Unknown method`, SSE fallback 404).
- Fixed TypeScript build stability under `verbatimModuleSyntax`: narrowed unknown Zod shape entries in MCP schema conversion, corrected `web/server.ts` tag helper import path, and replaced direct `bun-style` imports with a local style helper using type-only `ansi-styles` imports.
