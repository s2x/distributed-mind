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

- Added Cursor global L3 setup automation in `mind setup cursor`, writing managed idempotent hooks entries in `~/.cursor/hooks.json` and managed executable script artifacts in `~/.cursor/hooks/` with non-blocking fallback messaging.
- Added Codex global L2 managed protocol injection in `mind setup codex` by non-destructively upserting a managed block in `~/.codex/AGENTS.md`.
- Added setup regression coverage for Cursor/Codex idempotency and non-destructive behavior, including managed hooks/script artifacts and managed AGENTS.md block upsert checks.
- Added shared capability metadata module (`cli/src/cli/capabilities.ts`) so setup matrix output and recovery flows reuse the same L1/L2/L3 status/confidence/evidence/fallback declarations.
- Added integrated Recovery Pack generation for `checkpoint recover` (CLI + MCP) with `format` support (`text|md|json`) and capability-aware degradation guidance.
- Added checkpoint recovery tests covering format coherence (`text|md|json`), no-active-checkpoint guidance, and capability-profile fallback payloads.
- Added deterministic hybrid retrieval regression tests for weighted FTS+semantic ranking and semantic threshold fallback when FTS has no hits.
- Added a README agent status matrix (`Complete` / `Partial` / `Experimental` / `Roadmap`) mapped directly to current L1/L2/L3 capability declarations.
- Added capability-driven setup adapters for agent integrations with explicit L1/L2/L3 declarations (`supported`/`unsupported`/`unverified`) plus confidence/evidence/fallback diagnostics.
- Added default-on, non-blocking OpenCode prudent automation setup that writes a managed plugin (`~/.config/opencode/plugins/mind-automation.js`) with session start scaffolding, compaction continuity hooks, and prudent session summaries with deterministic anti-noise caps.
- Added setup capability diagnostics coverage in `cli/test/setup-capabilities.spec.ts`, including explicit Cursor `unverified` assertions for L2/L3 and fallback visibility checks.
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
- Added **experimental** capability declaration for `openclaw` as status-only output (`L1 unverified`, `L2/L3 unsupported`) with explicit fallback diagnostics and no setup wiring.
- Added Claude setup hardening coverage in `cli/test/setup-capabilities.spec.ts` for non-destructive reruns, managed block idempotency, and opt-in hook stability/idempotency.
- Added Gemini CLI and Windsurf setup capability regression assertions to keep evidence-based fallback diagnostics and avoid silent L2/L3 upgrades.

### Changed

- Changed search ranking (with RAG enabled) to deterministic weighted normalized hybrid scoring over FTS rank + semantic similarity, while keeping FTS-only behavior compatible when RAG is disabled.
- Changed `checkpoint recover` to remain the single recovery interface while adding Recovery Pack output and explicit capability-profile communication for degraded orchestration paths.

- Changed OpenClaw capability declaration from roadmap wording to explicit **experimental** status with stronger fallback diagnostics and no setup wiring overclaims.
- Changed README agent status labels from Spanish to English and improved status table header emphasis for clearer scanability.

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
- Changed `mind setup opencode` MCP transport wiring from remote HTTP URL to OpenCode-compatible local command transport (`type: "local"`, `command: ["<path-to-mind>", "mcp"]`).
- Hardened `mind setup opencode` to place the managed `~/.config/opencode/instructions/mind-memory-protocol.md` path as the first `instructions` entry (exact path, deduplicated), and updated the managed protocol text to explicitly require calling `mind_system_instructions` before tool usage.
- Changed `mind setup codex` MCP args to local stdio command mode (`args = ["mcp"]`) instead of forcing HTTP start flags.
- Changed `mind setup claude-code` to inject a managed protocol file plus managed block in `~/.claude/CLAUDE.md`, keeping setup idempotent/non-destructive.
- Added opt-in, non-blocking Claude L3 hook automation behind `MIND_SETUP_CLAUDE_ENABLE_HOOKS=true`, with explicit safe fallback messaging when disabled or unsupported.
- Added roadmap capability declarations (`vscode`, `antigravity`, `kiro`) to setup matrix output as status-only entries (no setup wiring).
- Refactored embedded protocol markdown into canonical files under `cli/src/resources/protocols/` and added shared loader `cli/src/helpers/markdown-resource.ts` for OpenCode/Claude setup injection and MCP `system_instructions` content.
- Changed `mind setup` matrix listing output to print full per-level status/confidence/evidence/fallback lines for each adapter (not only summarized statuses).

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
