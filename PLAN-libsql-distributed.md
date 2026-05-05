# Distributed Mind — Migration & Rebranding Plan (v2)

> **Status:** Ready for execution — incorporates decisions from team review
> **Target runtime:** Bun + `@libsql/client` (embedded replica) + `libsql-server` primary
> **Team size:** 20–30 AI-assisted developers
> **Concurrency model:** Knowledge-base eventual consistency, server-wins automatic conflict resolution, soft/hard write distinction
> **Total estimated effort:** **41–60 hours ≈ 5–8 working days** for one experienced developer (full breakdown in §7). Add ~1 day buffer for hot-fixes during the first week of team rollout.
> **Companion document:** [`NOTES-libsql-gotchas.md`](./NOTES-libsql-gotchas.md) — bun:sqlite vs libSQL gotchas to consult during Phase 1

---

## 1. Why we are doing this

### 1.1 The original `mind` was a personal CLI tool

The current codebase is a single-user, single-node SQLite application. It uses `bun:sqlite`, stores data in `./data/mind.db`, and assumes one developer on one machine. That design is excellent for a solo hacker, but it collapses the moment you want a **team of 20–30 developers** to share the same long-term memory.

### 1.2 What "distributed mind" actually means for us

We are building a **shared team brain** that survives:

- **Laptops going offline** (read-only locally; writes deferred — see §3 for sync model).
- **Concurrent writes** (handled by server-wins, not by merge — see §4).
- **New teammates joining mid-project** and needing the full history instantly.
- **Primary host failure** (mitigated by backups, not by replica reconstruction — see §11).

### 1.3 Framing — knowledge base, not OLTP

This is the most important framing decision. **Mind is an eventually-consistent shared knowledge base, not a transactional system.** Consequences:

- Some writes can be lost. We accept that.
- Some writes must persist. We treat them differently.
- We do not implement CRDTs, optimistic locking, or LLM-mediated conflict resolution in v1.
- We do not promise sub-second sync.

The split into **soft writes** (best-effort, agent-driven) and **hard writes** (durable, user-driven) is the load-bearing design decision and is documented in detail in §4.

### 1.4 Why libSQL embedded replica

| Backend | Considered | Rejected |
|---|---|---|
| **bun:sqlite** (status quo) | Zero deps, fast | Single-node only. No sync. |
| **mvSQLite** (FoundationDB VFS) | True multi-writer MVCC | Requires dynamic `libsqlite3` linkage. Bun embeds SQLite statically. Inaccessible without a Rust/C proxy — out of scope. |
| **Turso Database** | Cloud-native, concurrent writes | Beta. Not production-ready today. Future swap target. |
| **libSQL embedded replica** | Local SQLite file + sync to `libsql-server` primary. Stable. | Single-writer at primary. Writes in team mode go over network to primary (not local). Acceptable given knowledge-base framing. |

**Decision:** libSQL embedded replica now. When Turso Database matures, swap `syncUrl` and gain concurrent writes for free.

**Note on offline writes:** `@libsql/client` in team mode (with `syncUrl`) routes writes to the primary over the network. **It is not write-local-then-sync.** Offline = read-only for team mode. This is consistent with the knowledge-base framing — agents accept write failure when offline; users get an explicit error and choose to queue or retry. See §4 for write semantics.

---

## 2. Rebranding — HARD split, no aliases

### 2.1 Why a hard split (not a rename)

The rebrand is **not cosmetic**. It is a deployment safety mechanism that prevents three classes of silent corruption:

1. **Binary collision** — old `mind` running new code with old config silently writes solo data into a team-replica path.
2. **Config collision** — `MIND_DATA_DIR` set in someone's shell points to solo brain; new binary interprets it as team replica path; data loss.
3. **Update foot-gun** — `git pull && ./mind status` after the migration silently connects a private brain to the team primary.

A soft rebrand with `mind → dimind` symlinks and `MIND_* → DIMIND_*` env aliases (the previous draft of this plan) **defeats the safety purpose**. We do not do that.

### 2.2 What is renamed

- **New binary:** `dimind` (Bash entry script at repo root → `bun run src/dimind.ts`).
- **New entry module:** `src/dimind.ts` (composes async store + libSQL factory).
- **New database file:** `data/dimind.db` (NOT `mind.db`).
- **New env var prefix:** `DIMIND_*` (NOT aliased to `MIND_*`).
- **New Docker image:** `distributed-mind:latest` and `libsql-server` companion.

### 2.3 What is deliberately NOT renamed

- `mind` (Bash entry script) — frozen as-is. Security-fix-only.
- `data/mind.db` — solo database untouched.
- `MIND_*` env vars — work for old `mind` only.
- `src/mind.ts` — solo entry point unchanged.
- `bun:sqlite` backend — kept indefinitely for solo users.

**Result:** A solo user who never opts in to `dimind` sees zero changes. A user who installs `dimind` gets a clearly distinct tool with its own state.

### 2.4 Conflict detection at runtime

`dimind` performs two safety checks at startup:

1. **Detect legacy `mind.db`:**
   ```
   $ dimind status
   ⚠️  Detected data/mind.db (legacy solo brain).
       dimind uses data/dimind.db; your solo brain is untouched.
       To migrate solo data into team brain:  dimind import --from data/mind.db
       To suppress this warning:              export DIMIND_NO_LEGACY_WARNING=1
   ```

2. **Reject `MIND_*` env vars:**
   ```
   $ MIND_DATA_DIR=./data dimind status
   ✗ MIND_DATA_DIR is set, but dimind only reads DIMIND_* env vars.
     Aliases are deliberately not supported (prevents silent config collision).
     Did you mean: export DIMIND_DATA_DIR=./data ?
   ```
   This is a **hard error**, not a warning.

3. **No symlink** between `mind` and `dimind` is ever installed by setup.

### 2.5 Migration path solo → team

Explicit, one-time, opt-in:

```bash
# 1. Install dimind alongside mind (does not replace mind)
./scripts/install-dimind.sh

# 2. Configure team primary
cp .env.example.dimind .env
# Edit: DIMIND_SYNC_URL, DIMIND_SYNC_AUTH_TOKEN

# 3. Initial sync from primary (downloads team brain, may take 10s–60s)
dimind status

# 4. Optionally import solo brain into team (one-way, copies all spaces+memories)
dimind import --from data/mind.db --as-persistence soft

# 5. Continue using both: mind for solo, dimind for team
```

`--as-persistence soft` flag: imported memories default to `soft` because the solo user did not explicitly mark them as user-critical. User can promote individual memories with `dimind memory promote-to-hard <space> <name>` later.

---

## 3. Soft vs Hard Persistence Model

This section is new and load-bearing. Every later section references it.

### 3.1 Two write classes

| Class | Initiator | Examples | Value | On conflict | On offline |
|---|---|---|---|---|---|
| **Soft** | Agent autonomous | Auto-promote on read, access counter, auto-tagging, tier change, agent-generated session summaries, `memory_note` calls | Low — recoverable by re-running the agent | Server wins, lost silently | Best-effort lazy push, may be lost |
| **Hard** | User explicit | `dimind add` from CLI, Web UI save, agent calls `memory_remember` because user said "remember this" | High — must persist | Server wins (single primary serializes), audit trail in `memory_versions` records the loser | Synchronous to primary; **fails loudly** if primary unreachable |

### 3.2 Storage implications

Soft and hard memories live in the same `memories` table, distinguished by a `persistence` column (`'soft' | 'hard'`):

- **Soft memories:** subject to tier system (T1/T2/T3) + LRU eviction. Standard mind behavior.
- **Hard memories:** **not subject to LRU eviction**, **not counted toward tier limits**. They live alongside the tier system. Conceptually equivalent to "always pinned, plus more".
- **`memory_versions` table** records change history **for hard memories only**. Soft writes do not create version snapshots.

### 3.3 Conflict resolution policy (v1)

**Server wins, automatically. Both classes.**

- Hard writes are synchronous to primary, so primary serializes them. Two concurrent hard writes to same memory → primary applies them in arrival order; the later one fully overwrites the earlier. The loser is preserved in `memory_versions` for forensic recovery.
- Soft writes are pushed to primary lazily. If a soft write conflicts with state already at primary, server wins; local soft write is discarded.
- **No optimistic locking, no version columns enforced at primary, no conflict surfaced to LLM in v1.** This is acknowledged tech debt — `memory_versions` schema captures enough metadata to add proper conflict resolution later without migration (see §6).

### 3.4 Sync semantics per class

The default `syncInterval` of 30s is removed. Sync is **not** a uniform background tick.

- **Hard write path:** synchronous round-trip. App calls `client.execute()` against the libSQL client; the client forwards to primary; awaits ack; returns to app. Latency = network RTT + SQL exec. If primary unreachable, returns error immediately.
- **Soft write path:** writes go through the same client but the app does not block on primary ack; client buffers and flushes on its own schedule (or on next read).
- **Read path:** local replica file. Always served from local data. Replica is updated by:
  - Implicit pull on app startup.
  - Explicit `dimind sync` or `dimind sync --pull`.
  - No automatic background pull.
- **Manual sync:** `dimind sync` runs both push (any buffered soft writes) and pull (latest from primary). `dimind sync --pull` for read-only sync. `dimind sync --status` shows what is locally pending and what is new on primary.

### 3.5 MCP tool split

| Tool | Persistence | Description |
|---|---|---|
| `memory_remember` | hard | Agent calls when user said "remember this", "save this", or any explicit user request to persist information |
| `memory_note` | soft | Agent calls for autonomous bookkeeping — session summaries, observed patterns, internal notes |
| `memory_promote_to_hard` | converts soft→hard | Agent calls retrospectively when realizing a soft note should be hard |

The naming asymmetry is deliberate: `memory_remember` is mnemonic for "user told me to remember", `memory_note` is mnemonic for "I'm just taking notes". The agent protocol document (rendered through `system_instructions`) explicitly enumerates trigger phrases for each tool.

`memory_update` / `memory_edit`: single tool, persistence inherits from existing memory. Editing a hard memory creates a new `memory_versions` row; editing a soft memory does not.

`memory_delete` for hard memories: writes a final snapshot to `memory_versions` with `operation='delete'` before DELETE. Restorable by querying versions.

### 3.6 CLI / Web tool semantics

- `dimind add` (CLI) → **always hard.** User is at the terminal; this is explicit.
- Web UI save → **always hard.** User clicked the button.
- `dimind add --soft` → escape hatch for scripts that want soft semantics from CLI.
- Read commands (`dimind read`, `dimind list`, `dimind search`) — auto-promote and access counter side effects are **soft writes**. Their failure does not surface to the user.

---

## 4. Architecture after migration

```text
┌───────────────────────────────────────────────────────────────────┐
│  Dev laptop (Bun runtime)                                         │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  dimind CLI  /  dimind serve  /  dimind mcp                 │  │
│  │                                                             │  │
│  │  ┌───────────────────────────────────────────────────────┐  │  │
│  │  │  @libsql/client (embedded replica)                    │  │  │
│  │  │    url:           file:./data/dimind.db               │  │  │
│  │  │    syncUrl:       https://team-brain.example.com      │  │  │
│  │  │    authToken:     <JWT from DIMIND_SYNC_AUTH_TOKEN>   │  │  │
│  │  │    intMode:       'number' (gotchas §1)               │  │  │
│  │  │  No automatic background sync.                        │  │  │
│  │  │  Hard writes:  sync round-trip to primary.            │  │  │
│  │  │  Soft writes:  buffered, flushed on read or manual.   │  │  │
│  │  └───────────────────────────────────────────────────────┘  │  │
│  │             │                                                │  │
│  │             ▼ (writes always to primary in team mode)        │  │
│  │             ▼ (reads always from local replica file)         │  │
│  │                                                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
                               │
                               │ HTTPS only (Caddy/Traefik reverse proxy)
                               │ JWT auth
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  Team server (Docker host)                                         │
│                                                                    │
│  ┌────────────────────────┐    ┌────────────────────────────────┐  │
│  │  Caddy reverse proxy   │───▶│  libsql-server (primary)       │  │
│  │  TLS termination       │    │  /var/lib/sqld/dbs/...         │  │
│  │  JWT verification      │    └────────────────────────────────┘  │
│  └────────────────────────┘                  │                     │
│             ▲                                ▼                     │
│             │                ┌──────────────────────────────────┐  │
│             │                │  S3 backup cron (optional)       │  │
│  All replicas               │  cp snapshots → S3 every 6h      │  │
│                              └──────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

### 4.1 Key invariants

- **Reads always local.** Zero network latency on read path.
- **Writes always remote in team mode.** Local replica is read cache + write forwarder, not a write buffer (except for soft writes' lazy flush).
- **HTTPS mandatory.** Plain HTTP is not supported in v1. Setup scripts refuse to configure non-HTTPS `DIMIND_SYNC_URL`.
- **Audit trail for hard writes.** Every UPDATE / DELETE on a hard memory creates a `memory_versions` row. Soft writes do not.
- **No automatic sync interval.** Sync is event-driven (hard write, manual command).
- **Schema v8 fresh on libSQL.** No migration from v1–v7. Existing solo `mind.db` users keep using their bun:sqlite path.

### 4.2 Failure modes and behaviors

| Scenario | Behavior |
|---|---|
| Primary unreachable, hard write attempted | Returns error to caller. CLI prints clear message. Agent receives MCP error. |
| Primary unreachable, soft write attempted | Buffered locally; pushed on next reachable opportunity. May be lost if local replica is destroyed before reachable. |
| Primary unreachable, read | Served from local replica. Stale, but works. |
| Concurrent hard writes to same memory | Primary serializes. Loser preserved in `memory_versions`. Both callers get success acks. No conflict surfaced. |
| Local replica corrupted | Delete file; `dimind status` re-syncs from primary. Lost: any unflushed soft writes. |
| Primary corrupted | Restore from backup (S3 or volume snapshot). Replicas re-sync on next `dimind sync`. |
| Network slow during hard write | Sync write hangs up to client timeout, then errors. Agent should treat as transient. |

---

## 5. Environment variables

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `DIMIND_DATABASE_URL` | No | `file:./data/dimind.db` | Local embedded-replica path. Must start with `file:`. |
| `DIMIND_SYNC_URL` | Yes (team mode) | — | Primary URL. **Must use `https://`** unless `DIMIND_ALLOW_INSECURE_SYNC=1` (for local dev only). If absent, `dimind` runs in **solo offline mode** (no sync; functionally equivalent to `mind` but using libSQL backend). |
| `DIMIND_SYNC_AUTH_TOKEN` | Yes when `DIMIND_SYNC_URL` set | — | JWT for primary auth. |
| `DIMIND_DATA_DIR` | No | `./data` | Used to derive `dimind.db` when `DIMIND_DATABASE_URL` not set. |
| `DIMIND_CLIENT_ID` | No | hostname + USER hash | Stable client identifier written into `memory_versions.client_id` and `memories.client_id` for future per-user audit / GDPR purge. |
| `DIMIND_NO_LEGACY_WARNING` | No | unset | Suppresses the `data/mind.db detected` startup warning (§2.4). |
| `DIMIND_ALLOW_INSECURE_SYNC` | No | unset | Allows `http://` in `DIMIND_SYNC_URL` (dev only). Setup refuses to configure this in production. |
| `DIMIND_BACKUP_S3_BUCKET` | No | unset | Optional S3 bucket for primary backups (cron-driven, runs on primary host). |
| `DIMIND_BACKUP_INTERVAL_HOURS` | No | `6` | Backup frequency on primary host. |
| `MIND_*` | — | — | **Hard error in dimind context.** Aliases are deliberately not supported (§2.4). |

**Removed from earlier draft:**
- `DIMIND_SYNC_INTERVAL` — no automatic background sync (§3.4).

---

## 6. Database schema additions

### 6.1 New columns on `memories` (schema v8)

```sql
ALTER TABLE memories ADD COLUMN persistence TEXT NOT NULL DEFAULT 'soft'
  CHECK (persistence IN ('soft', 'hard'));
ALTER TABLE memories ADD COLUMN created_by TEXT;        -- hostname/USER snapshot at creation
ALTER TABLE memories ADD COLUMN client_id TEXT;         -- DIMIND_CLIENT_ID at creation
```

- Default `'soft'` ensures legacy migrations and bun:sqlite imports land as soft (user can promote individual entries to hard).
- `created_by` and `client_id` enable future admin tools (per-user purge) without schema migration.

### 6.2 New table `memory_versions` (audit trail for hard writes)

```sql
CREATE TABLE memory_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id       INTEGER NOT NULL,
  space_name      TEXT NOT NULL,
  name            TEXT NOT NULL,
  content         TEXT NOT NULL,
  tags            TEXT,                  -- JSON-serialized array snapshot
  tier            INTEGER,
  persistence     TEXT NOT NULL,         -- snapshot of persistence at time of change
  version_number  INTEGER NOT NULL,      -- monotonic per memory_id, starts at 1
  operation       TEXT NOT NULL CHECK (operation IN ('update', 'delete', 'revert', 'create')),
  changed_by      TEXT,                  -- hostname/USER snapshot
  client_id       TEXT,                  -- DIMIND_CLIENT_ID snapshot
  changed_at      TEXT NOT NULL          -- UTC ISO 8601, generated in app code (gotchas §9)
);

CREATE INDEX idx_versions_memory_id     ON memory_versions(memory_id);
CREATE INDEX idx_versions_changed_at    ON memory_versions(changed_at);
CREATE INDEX idx_versions_persistence   ON memory_versions(persistence);
CREATE INDEX idx_versions_client_id     ON memory_versions(client_id);
CREATE INDEX idx_versions_operation     ON memory_versions(operation);
```

- **Storage policy v1: keep everything.** No retention cron. No tombstone table. No GDPR purge tool. All deferred to backlog.
- **Schema is retention-ready.** Indexes on `persistence`, `changed_at`, `client_id`, `operation` enable future cleanup queries without migration:
  - `WHERE persistence='soft' AND changed_at < ?` (soft history retention by age — but we do not record soft history in v1, this row exists for design symmetry)
  - `ROW_NUMBER() OVER (PARTITION BY memory_id ORDER BY version_number DESC)` (count-based per memory)
  - `WHERE client_id = ?` (per-user GDPR purge)
  - `WHERE operation='delete' AND changed_at < ?` (tombstone cleanup)

### 6.3 What is NOT added in v1

- No `memory_tombstones` table — `memory_versions` with `operation='delete'` serves recovery.
- No retention cron — disk grows linearly. Revisit when ≥ 1 GB.
- No `version` column on `memories` for optimistic locking — server-wins is the v1 policy.
- No `memory_history` for soft memories — soft writes do not create snapshots.

### 6.4 Schema versioning

- Current schema: **v7**.
- New target: **v8** (adds columns + `memory_versions`).
- Solo `mind` (bun:sqlite) is **not** auto-migrated to v8. Solo schema stays at v7 forever (or until owner explicitly migrates).
- Fresh libSQL bases initialize at v8 directly. No mid-migration code path on libSQL.
- v8 → v9 future migrations: same 12-step rename-and-recreate pattern; documented in the schema `MIGRATIONS` array.

---

## 7. Implementation phases

### Phase 0 — Async `MindStore` refactor (6–9 h)

**Goal:** Make every `MindStore` method return `Promise<T>`, since `@libsql/client` has no synchronous API.

**Files touched:**
- `src/store/mind-store.ts` — every method signature → `Promise<T>` (~45 methods).
- `src/store/sqlite-store.ts` — async wrappers around bun:sqlite calls.
- `src/store/repositories/*.ts` — 6 files, ~1830 lines, ~88 direct `db.query/run/exec` calls.
- `src/cli/commands/*.ts`, `src/cli/command-executor.ts` — 153 store call sites; add `await` to each.
- `src/api/server.ts`, `src/api/routes/*.ts` — same.
- `src/mcp/server.ts`, `src/mcp/handlers/**/*.ts` — same.
- `test/mocks/test-store.ts` and ~22 spec files (~7300 lines) — async assertions, error-throw patterns.

**Pitfalls explicitly called out:**

- **`db.transaction(() => {...})` is synchronous in bun:sqlite.** Async callbacks inside the closure will not be awaited. The five existing transaction blocks (memory-repository, tag-repository) must be either rewritten or wrapped in synchronous boundaries. This is non-trivial — the bodies do conditional logic and reads.
- **Forgotten `await` is a silent bug.** A forgotten `await store.foo()` returns a Promise that is silently discarded; the test passes but state is wrong. Strict mode + ESLint `@typescript-eslint/no-floating-promises` is **mandatory** before this refactor.
- **`recordAccess` is called transitively from `getMemory` (auto-promote).** Sync chain becomes async chain; concurrent reads can interleave their writes. Acceptable per soft-write semantics, but document.
- **Test rewrites:** patterns like `expect(() => store.foo()).toThrow()` must become `await expect(store.foo()).rejects.toThrow()`. Mass find/replace + manual review.

**Validation:**
- `bun test` passes against unchanged `bun:sqlite` backend. Zero behavioral changes from user perspective.
- ESLint `no-floating-promises` clean.
- `tsc --noEmit` clean.

---

### Phase 1 — libSQL store + repositories (14–20 h, MONOLITHIC, work-ordered)

**Goal:** Implement a complete `MindStore` backend on `@libsql/client`. No partial release.

**Why monolithic:** The composer requires all 6 repositories. There is no "1a-only" deployable artifact. The split into 1a/1b discussed in earlier draft adds ceremony without value.

**Why work-ordered:** Doing simple repos first surfaces ~70% of libSQL gotchas in the first 3 hours. If something fundamental is broken, "abandon project" costs 3h, not 20h.

**Work order:**

| Step | Repo / file | Effort | What it validates |
|---|---|---|---|
| 1 | Schema init + factory plumbing (`createLibsqlStore` + `initializeLibsqlDatabase`) | 1.5 h | PRAGMA handling, batch statement split (gotchas §12), `intMode: 'number'` (gotchas §1) |
| 2 | `libsql-repositories/log-repository.ts` (~232 lines) | 1 h | Simplest INSERT-heavy repo. Validates BigInt → number, `lastInsertRowid` from `execute()`. |
| 3 | `libsql-repositories/space-repository.ts` (~179 lines) | 1 h | CRUD with no transactions. Validates boolean (hidden), tag table cascade behavior. |
| 4 | `libsql-repositories/link-repository.ts` (~62 lines) | 0.5 h | FK CASCADE between memories (gotchas §13). Integration test: delete space → links vanish. |
| 5 | `libsql-repositories/tag-repository.ts` (~70 lines) | 0.5 h | First batch transaction. Restructure `db.transaction` → `client.batch(..., 'write')` (gotchas §3). |
| 6 | `libsql-repositories/memory-repository.ts` (~665 lines) | 3–4 h | The big one. BLOB embeddings (gotchas §2), `RETURNING id` instead of `lastInsertRowid` chained (gotchas §4), LRU eviction restructured into batches, FTS sync calls, `addMemory` / `patchMemory` / `updateMemory` all rewritten. New: `persistence` column wiring, `memory_versions` snapshot on hard writes. |
| 7 | `libsql-repositories/search-repository.ts` (~623 lines) | 2–3 h | FTS5 MATCH binding test (gotchas §6). If fails, escape-and-inject path. Hybrid retrieval (FTS + cosineSimilarity over BLOB embeddings). |
| 8 | Test parametrization: run `mind-store.spec.ts` (1028 lines) against libSQL backend | 2–3 h | Full parity verification. Spec gets a `createStore: () => Promise<MindStore>` parameter; same assertions run against both backends. |
| 9 | Inline gotcha fixes & integration testing | 2–3 h | Buffer for surprises (`datetime('now')` UTC drift, error code differences, etc.) |

**Why this order:** Steps 1–5 (~4 h) exercise the core libSQL surface (`execute`, `batch`, BigInt, BLOB, FK, transactions). Steps 6–7 are where most bugs surface but with infrastructure validated. Step 8 ensures parity with bun:sqlite.

**New tests added:**
- `test/libsql-store.spec.ts` — wraps `mind-store.spec.ts` with libSQL backend factory.
- `test/libsql-blob-roundtrip.spec.ts` — Float32Array embedding round-trip parity (gotchas §2).
- `test/libsql-fk-cascade.spec.ts` — explicit FK CASCADE verification (gotchas §13).
- `test/libsql-fts5-match.spec.ts` — FTS5 MATCH parameter binding regression (gotchas §6).
- `test/libsql-persistence-versioning.spec.ts` — hard-write versions appear; soft-write versions do not.

**Reference document:** [`NOTES-libsql-gotchas.md`](./NOTES-libsql-gotchas.md). Every developer working in this phase must read it once. Update it inline with new gotchas discovered during implementation.

---

### Phase 2 — Factory, Docker, sync semantics (4–6 h)

**Goal:** Backend selectable at runtime. Soft/hard sync routing wired. Docker primary container stood up.

**Factory (`src/store/factory.ts`):**

```ts
export async function createStore(): Promise<MindStore> {
  const dbUrl = process.env.DIMIND_DATABASE_URL;
  const syncUrl = process.env.DIMIND_SYNC_URL;

  // Refuse non-HTTPS unless explicitly allowed
  if (syncUrl && !syncUrl.startsWith('https://') && process.env.DIMIND_ALLOW_INSECURE_SYNC !== '1') {
    throw new Error(
      `DIMIND_SYNC_URL must use https:// (got ${syncUrl}). ` +
      `Set DIMIND_ALLOW_INSECURE_SYNC=1 for local dev only.`
    );
  }

  // Reject MIND_* env (§2.4)
  rejectLegacyEnvVars();

  if (dbUrl?.startsWith('file:')) {
    return createLibsqlStore({
      url: dbUrl,
      syncUrl,
      authToken: process.env.DIMIND_SYNC_AUTH_TOKEN,
      intMode: 'number',
      clientId: getOrComputeClientId(),
    });
  }

  // dimind in solo libSQL mode (no syncUrl)
  return createLibsqlStore({ url: dbUrl ?? `file:${CONFIG.dbPath}`, intMode: 'number' });
}
```

**Sync routing (in `libsql-store.ts`):**
- Hard writes: invoke `client.execute()` directly. Synchronous round-trip to primary.
- Soft writes: invoke `client.execute()` but do not await client's primary-ack flag (best-effort). Implementation detail of `@libsql/client`: confirm whether the lib offers a "fire-and-forget" mode; if not, hard and soft both await but differ in error handling (hard surfaces error, soft logs and swallows).

**`dimind sync` command:**
- `dimind sync` → push pending soft writes + pull primary state.
- `dimind sync --pull` → pull only.
- `dimind sync --push` → push only.
- `dimind sync --status` → display: pending soft writes count, last successful pull timestamp, primary reachable y/n.

**Docker Compose (`docker-compose.libsql.yml`):**

```yaml
services:
  libsql-primary:
    image: ghcr.io/tursodatabase/libsql-server:latest
    platform: linux/amd64
    expose:
      - "8080"
    volumes:
      - ./data/libsql-primary:/var/lib/sqld
    environment:
      - SQLD_NODE=primary
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    restart: unless-stopped

  backup:                     # optional, gated by DIMIND_BACKUP_S3_BUCKET
    image: amazon/aws-cli:latest
    profiles: ["backup"]
    volumes:
      - ./data/libsql-primary:/data/libsql-primary:ro
      - ./scripts/backup.sh:/usr/local/bin/backup.sh
    entrypoint: ["/bin/sh", "-c", "while true; do /usr/local/bin/backup.sh; sleep ${DIMIND_BACKUP_INTERVAL_HOURS:-6}h; done"]

volumes:
  caddy_data:
  caddy_config:
```

**Caddyfile:**

```caddy
team-brain.example.com {
  reverse_proxy libsql-primary:8080
  # JWT verification handled by libsql-server itself via auth token
  encode gzip
  log {
    output stdout
    format json
  }
}
```

**Validation:**
- `docker compose -f docker-compose.libsql.yml up -d` — primary + caddy running, HTTPS reachable.
- `DIMIND_SYNC_URL=https://team-brain.example.com DIMIND_SYNC_AUTH_TOKEN=... dimind status` — replica syncs initial state.
- `test/sync-integration.spec.ts` — two clients write to same primary, observe server-wins behavior.

---

### Phase 3 — Audit schema + new MCP tools (6–8 h)

**Goal:** Schema additions from §6 wired into the libSQL store. New MCP tools `memory_remember` / `memory_note` / `memory_promote_to_hard` exposed.

**Tasks:**

1. Schema migration v7 → v8 in libSQL initialization path (~30 min). Adds `persistence`, `created_by`, `client_id` to `memories`; creates `memory_versions` table + indexes.
2. Update `MemoryRepository.addMemory`, `updateMemory`, `patchMemory`, `deleteMemory`, `deleteMemoryByName` to:
   - Accept `persistence` parameter.
   - Snapshot to `memory_versions` for hard memories before UPDATE/DELETE.
   - Skip LRU/tier eviction for hard memories.
   - Skip tier-limit check for hard memories.
   - Stamp `client_id`, `created_by`, `changed_by` from env. (~2 h)
3. Add `MindStore.promoteToHard(space, name)` and `MindStore.demoteToSoft(space, name)` methods (~30 min).
4. New MCP tool definitions in `src/mcp/tools/memories.ts`:
   - `memory_remember` (hard add)
   - `memory_note` (soft add)
   - `memory_promote_to_hard`
   - `memory_demote_to_soft`
   - Updated `memory_read` returns `persistence` field. (~1 h)
5. New MCP handlers in `src/mcp/handlers/memories/` (~1 h).
6. CLI commands: `dimind memory promote-to-hard`, `dimind memory demote-to-soft`. `dimind add` defaults to hard, `dimind add --soft` opts in to soft. (~30 min).
7. Tests:
   - `test/persistence-model.spec.ts` — hard writes create versions; soft do not; LRU skips hard; tier limits skip hard.
   - `test/mcp-memory-remember-note.spec.ts` — new MCP tools.
   - Update `test/mcp-tools.spec.ts` for the new tool count. (~2 h)
8. Update `src/resources/protocols/mind-memory-protocol.template.md` and `mind-system-instructions.md` to teach agents about `memory_remember` vs `memory_note` and trigger phrases. (~1 h)

**Validation:**
- `dimind memory remember projects/foo "API endpoint" "POST /v2/users"` creates hard memory with version row.
- `dimind memory note projects/foo "session-2026-05" "..."` creates soft memory with no version row.
- Concurrent hard writes to same memory observed in `memory_versions` (loser preserved).
- LRU eviction in T1 with mix of hard + soft → only soft demoted.

---

### Phase 4 — Operations (5–7 h)

**Goal:** Production-readiness for team rollout. TLS, backups, governance docs.

**Tasks:**

1. **HTTPS / Caddy config** (1.5 h)
   - Caddyfile in repo root.
   - Documentation for ACME / Let's Encrypt setup vs internal CA.
   - Setup script `scripts/setup-team-server.sh` that wires it up.

2. **JWT auth** (1.5 h)
   - libsql-server JWT configuration.
   - Token issuance script `scripts/issue-jwt.sh` for team admin.
   - Token rotation runbook (90-day default).
   - Document where tokens are stored on dev laptops (`.env`, never committed).

3. **Backup primary** (1.5 h)
   - `scripts/backup.sh` — runs on primary host, snapshots libSQL data dir, optional S3 sync.
   - Cron entry or backup container (gated by `DIMIND_BACKUP_S3_BUCKET`).
   - Local retention: 7 daily + 4 weekly + 3 monthly snapshots.
   - **Restore procedure tested at least once** before team rollout. Document in `scripts/restore.sh`.

4. **Portable export / import** (1 h)
   - `dimind export --format sql` produces a portable SQL dump.
   - `dimind import --from <file>` accepts SQL dump or legacy JSON.
   - Tests round-trip.
   - Used for: solo→team migration (§2.5), one-off data movement, debugging.

5. **Governance docs** (1 h)
   - New section in README: "What goes in team brain, what does not".
   - Naming conventions: `user/<username>/preferences` for per-user, `projects/<name>` shared, etc.
   - Credential leak handling: `dimind remove` + manual SQL on primary.
   - Off-boarding procedure: documented but not automated.

**Validation:**
- HTTPS-only enforced; HTTP redirected to HTTPS.
- JWT rejected after expiry; client gets clear error.
- S3 backup observable in bucket.
- Restore from S3 backup produces identical primary state.
- Governance doc reviewed by team lead.

---

### Total realistic budget

| Phase | Effort |
|---|---|
| Phase 0 — async refactor | 6–9 h |
| Phase 1 — libSQL store (monolithic, work-ordered) | 14–20 h |
| Phase 2 — factory + Docker + sync routing | 4–6 h |
| Phase 3 — audit schema + new MCP tools | 6–8 h |
| Phase 4 — operations (TLS, backup, governance, export) | 5–7 h |
| Integration testing, debugging, CHANGELOG, AGENTS.md updates | 6–10 h |
| **Total** | **41–60 h ≈ 5–8 working days** |

**No spike phase.** Gotchas surface inline during Phase 1 and are documented in `NOTES-libsql-gotchas.md` as they appear.

**Buffer recommendation:** Schedule one additional day (8 h) for hot-fixes in the first week of team rollout. Initial deployment will surface integration issues that didn't appear in test environment.

---

## 8. Operations

This section documents production-mode practices and is the canonical source for Phase 4 deliverables.

### 8.1 HTTPS via reverse proxy (mandatory)

- Caddy or Traefik in front of `libsql-server`.
- TLS termination at proxy. `libsql-server` internal port not exposed.
- Plain HTTP refused by `dimind` factory unless `DIMIND_ALLOW_INSECURE_SYNC=1` (dev only).

### 8.2 JWT auth

- libsql-server natively supports JWT. Token issued by team admin via `scripts/issue-jwt.sh`.
- Token contains: dev identifier, expiry (default 90 days), no claims beyond auth.
- Rotation: every 90 days. Calendar reminder for team admin.
- Storage: `.env` on dev laptop. Never committed. `.env.example.dimind` ships as template.

### 8.3 Backup primary

- **Required.** Primary host is single point of failure for team-brain data.
- Mechanism: `scripts/backup.sh` runs `cp` snapshot on primary container's volume every 6 hours (configurable).
- Local retention: 7 daily + 4 weekly + 3 monthly = 14 snapshots ≈ <50 MB for typical teams.
- **Optional S3 sync:** when `DIMIND_BACKUP_S3_BUCKET` set, latest snapshot uploaded after each local snapshot.
- **Restore procedure** documented in `scripts/restore.sh`; **tested before team rollout**.

### 8.4 Governance & access control

- **No ACL in v1.** Team brain is fully shared read/write.
- **Naming conventions enforce logical separation:**
  - `user/<username>/preferences` — per-user preferences (still readable by all).
  - `user/<username>/scratch` — per-user scratch space.
  - `projects/<repo>` — shared per-project.
  - `global/config` — cross-team.
- **Credential leak handling:** developer notices a credential in mind → `dimind remove --hard <space> <name>`. Final snapshot lands in `memory_versions`; admin manually purges via SQL on primary if needed.
- **Off-boarding:** when a team member leaves, their memories stay. Future admin tool will support per-`client_id` purge; until then, manual SQL.
- **GDPR / right-to-be-forgotten:** documented manual procedure, no automated tool in v1.

### 8.5 Portable export / import

- `dimind export --format sql > backup.sql` produces a backend-portable dump.
- `dimind import --from backup.sql` accepts dumps from either backend.
- Used for: ad-hoc backups, debugging, solo↔team data movement.

### 8.6 Disaster recovery procedures

| Scenario | Procedure |
|---|---|
| Primary host dies | Restore primary from latest backup. Replicas auto-resync on next `dimind sync`. RPO ≤ 6 h (backup interval). |
| Primary database corrupted | Same as above. |
| Replica file corrupted | `rm data/dimind.db && dimind status` — re-syncs from primary. Lost: any unflushed soft writes since last sync. |
| Network partition (replica offline) | Reads work locally; hard writes fail with clear error; soft writes buffer. On reconnect, soft buffer flushes. |
| JWT compromise | Rotate token immediately via `scripts/issue-jwt.sh --revoke <client_id>`. Replicas using compromised token get auth error. |

---

## 9. What is deliberately out of scope (v1)

| Feature | Why out of scope | When it might return |
|---|---|---|
| **mvSQLite backend** | Requires Rust/C proxy; incompatible with Bun static SQLite. | If `mvsqlite-http-gateway` matures or Bun adds dynamic VFS. |
| **Turso Database backend** | Beta. | When GA. Swap `syncUrl`. |
| **CRDT / event sourcing** | Overkill for knowledge-base eventual consistency. | If real-time collaborative single-memory editing becomes a requirement. |
| **Optimistic locking on hard writes** | Server-wins is acceptable v1; loser preserved in `memory_versions` for forensic recovery. | If observed data loss complaints from team. |
| **LLM-mediated conflict resolution** | Server-wins handles all conflicts in v1. | Same trigger as above. |
| **Native libSQL vector search** | Existing JS `cosineSimilarity` over BLOB works fine. | When benchmarks show JS similarity is bottleneck. |
| **Automatic SQLite → libSQL migration on first run** | Hard rebrand keeps them separate. Manual `dimind import` is the path. | Not planned. |
| **Real-time sync (< 1 s)** | Knowledge-base framing accepts seconds-to-minutes lag. Hard writes are synchronous so there is no lag for explicit user actions. | Turso GA may bring this. |
| **Retention / cleanup of `memory_versions`** | Schema captures everything; v1 keeps it all. | When disk usage on primary exceeds 1 GB or team complains. |
| **Tombstone table / restore-after-delete UX** | `memory_versions` with `operation='delete'` covers recovery via `dimind restore`. Separate tombstone table is YAGNI. | If UX needs structured "trash bin" view. |
| **Rollback path libSQL → bun:sqlite** | Hard rebrand means abandoning team mode is just "stop using `dimind`"; solo `mind` was never touched. | Project failure exit, not a rollback. |
| **Admin purge tool / GDPR automation** | Documented manual procedure suffices for 30-person team. | When team grows or compliance audit demands it. |
| **ACL / per-space permissions** | Team brain is fully shared by design. | If business requirements force partition. |
| **Soft-write conflict UX** | Soft = best-effort. Lost is acceptable. | Never planned. |

---

## 10. Rollout strategy for the team

### 10.1 Pre-rollout checklist

- [ ] Phase 0–4 implementation complete.
- [ ] All Phase tests passing in CI.
- [ ] Restore-from-backup procedure executed once and verified.
- [ ] Caddy + JWT config deployed and tested with a single canary client.
- [ ] `NOTES-libsql-gotchas.md` reviewed and current.
- [ ] CHANGELOG.md and AGENTS.md updated.

### 10.2 Canary rollout (days 1–3)

- **Day 1:** team admin and 1 trusted dev opt in to `dimind`. Initial sync timed and recorded. Both run normal workflows for 24 h.
- **Day 2:** if no incidents, expand to 3–5 devs. Watch for: replica corruption, JWT issues, write failures, surprising behaviors.
- **Day 3:** if still clean, full team can opt in.

### 10.3 New teammate onboarding (post-canary)

```bash
# 1. Clone
git clone git@github.com:our-org/distributed-mind.git
cd distributed-mind
bun install

# 2. Install dimind binary alongside existing mind
./scripts/install-dimind.sh

# 3. Configure team primary
cp .env.example.dimind .env
# Edit:
#   DIMIND_SYNC_URL=https://team-brain.example.com
#   DIMIND_SYNC_AUTH_TOKEN=<jwt-from-team-admin>

# 4. First sync (downloads team brain; 10s–60s depending on size)
dimind status

# 5. Done. Use dimind for team brain, mind stays for solo work.
```

### 10.4 Solo → team data migration (optional, opt-in)

```bash
# One-way: copy solo brain into team as soft memories
dimind import --from data/mind.db --as-persistence soft

# Promote individual memories user wants forever-persisted
dimind memory promote-to-hard projects/foo "Important Decision"
```

### 10.5 Project abandonment exit (if libSQL fundamentally fails)

```bash
# Stop using dimind; solo mind is untouched
unset DIMIND_SYNC_URL
# delete dimind binary and data
rm -rf data/dimind.db ./dimind
# continue with mind as before
mind status
```

No data migration needed — solo `mind.db` was never modified.

---

## 11. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Async refactor introduces silent floating Promises** | Medium | High | Mandatory ESLint `no-floating-promises` before refactor. Code review of every `await` site. |
| **libSQL gotcha (BigInt, BLOB, batch, FTS5) blocks Phase 1** | Medium | High | Work-ordered phase surfaces gotchas early. `NOTES-libsql-gotchas.md` provides head-start mitigations. Step 1–5 act as cheap canary. |
| **`db.transaction` → `client.batch` rewrite changes semantics** | Medium | High | Comprehensive `mind-store.spec.ts` parametrized against both backends. New tests for tier eviction, FTS sync, link consistency. |
| **FK CASCADE behavior differs on libSQL replica** | Low | High | Explicit `test/libsql-fk-cascade.spec.ts` integration test before Phase 1 ships. |
| **Hard write during primary outage loses data** | Low (primary is on team-server, dev laptops are clients) | Medium | `dimind sync --status` shows pending state. CLI/Web errors are loud. Soft buffer flushes on reconnect. |
| **Concurrent hard writes lose one writer's content silently** | Low | Medium | `memory_versions` audit trail enables forensic recovery. `dimind history <space> <name>` exposes versions. Future iteration may add optimistic locking. |
| **Primary host dies / disk fails** | Medium | **Catastrophic** | Backups every 6 h with optional S3 off-host. **Restore procedure tested before rollout.** |
| **JWT leak / compromise** | Low | High | Rotation runbook (90 days). `scripts/issue-jwt.sh --revoke`. HTTPS-only ensures token not sniffable in flight. |
| **Plain HTTP misconfiguration leaks data** | Low | High | Factory refuses non-`https://` `DIMIND_SYNC_URL` unless explicit dev flag. Caddy enforces HTTPS-only. |
| **`MIND_*` env from old shell collides with `dimind`** | Medium | Medium | Hard error at startup with migration instructions. No silent acceptance. |
| **Initial sync time is unexpectedly long** | Low | Low | Document expected 10s–60s in onboarding. Tune `libsql-server` snapshot tuning if exceeds. |
| **`memory_versions` disk growth becomes problematic** | Medium (at scale) | Low | Schema is retention-ready (indexes on `persistence`, `changed_at`, `client_id`). Add cleanup cron when needed; no migration required. |
| **GDPR request lands before admin purge tool exists** | Low | Medium | Manual procedure documented in §8.4. |
| **Schema v8 assumption fails on libSQL primary** | Low | High | Work-ordered Phase 1 step 1 validates schema init; failure surfaces in 1.5 h not 20 h. |

---

## 12. Definition of done

- [ ] `bun test` passes for legacy `sqlite-store.ts` (zero regressions).
- [ ] `bun test test/libsql-store.spec.ts` passes (parametrized full `mind-store.spec.ts`).
- [ ] `bun test test/libsql-blob-roundtrip.spec.ts` passes (gotchas §2).
- [ ] `bun test test/libsql-fk-cascade.spec.ts` passes (gotchas §13).
- [ ] `bun test test/libsql-fts5-match.spec.ts` passes (gotchas §6).
- [ ] `bun test test/persistence-model.spec.ts` passes (hard vs soft semantics).
- [ ] `bun test test/sync-integration.spec.ts` passes (two clients + primary + server-wins observed).
- [ ] `docker compose -f docker-compose.libsql.yml up -d` produces a working primary behind Caddy HTTPS.
- [ ] `./dimind --version` returns and is distinct from `./mind --version`.
- [ ] `MIND_*` env vars in dimind context produce hard error.
- [ ] `data/mind.db` detected on dimind startup produces clear warning.
- [ ] `dimind memory remember` creates `memory_versions` row; `dimind memory note` does not.
- [ ] `dimind sync --status` reports correct pending state.
- [ ] `dimind export --format sql` round-trips through `dimind import`.
- [ ] Restore-from-backup procedure executed and verified once.
- [ ] `AGENTS.md`, `CHANGELOG.md`, `README.md`, `NOTES-libsql-gotchas.md` updated.
- [ ] New dev clone → `bun install` → set DIMIND env → see team memories within 60 s.
- [ ] Canary rollout (3 days, 5 devs) completed without incident before full team opt-in.

---

## 13. Appendix: name decision log

**Chosen public name:** `distributed-mind` (repo, Docker image, docs).
**Chosen CLI name:** `dimind` (short, memorable, distinct from existing tools).
**No backwards-compat alias.** Hard split is the safety mechanism (§2).

Rationale against alternatives:
- `swarm-mind` — too abstract, blockchain vibes.
- `memhive` — cute but opaque.
- `dimind` alone as repo name — ambiguous spelling ("dim mind" vs "di-mind").
- Soft rebrand with `mind → dimind` symlink — defeats deployment safety, rejected.

The combination `distributed-mind` (repo/image/brand) and `dimind` (CLI/binary) gives clear branding and a short daily command without colliding with the existing solo `mind`.

---

## 14. Decision log (this revision)

This v2 of the plan supersedes the original draft after team review. Key decision changes:

| # | Decision | Rationale |
|---|---|---|
| D1 | Knowledge-base framing (not OLTP) | Mind tolerates write loss for soft entries; hard entries get stricter handling. Simplifies architecture dramatically. |
| D2 | Soft / hard persistence split with `memory_remember` / `memory_note` MCP tools | User-explicit writes deserve durability; agent-autonomous writes do not. Two tools (not one with parameter) make the choice visible at call site. |
| D3 | Server-wins automatic conflict resolution, no LLM-mediated resolution v1 | Acceptable for knowledge base. Simpler. `memory_versions` enables forensic recovery for hard losers. |
| D4 | No automatic background sync; sync is event-driven (hard write) or manual (`dimind sync`) | Predictable behavior; no surprise stale reads. |
| D5 | Hard rebrand (no `mind → dimind` symlink, no `MIND_* → DIMIND_*` aliases) | Prevents silent config collision. Enables "abandon project" exit strategy. |
| D6 | No spike phase; gotchas discovered inline during Phase 1 | Spike was overkill for knowledge-base framing. Work-ordered Phase 1 surfaces gotchas in first 3 h. |
| D7 | Phase 1 monolithic (not 1a/1b split) | Cannot ship partial backend. Work order matters; phase split adds ceremony. |
| D8 | No rollback path (libSQL → bun:sqlite); abandon project if it fails | Solo `mind` was never modified, so abandonment costs only team experiment data. |
| D9 | Schema-prepared, mechanism-deferred retention | `memory_versions` captures everything in v1; cleanup mechanism added later when storage hurts. No future migration needed. |
| D10 | HTTPS + JWT mandatory; S3 backup optional | Team brain may contain sensitive data; HTTPS is non-negotiable. Backup is ops concern but documented and tested. |
| D11 | No ACL, no GDPR purge tool in v1 | Team brain is fully shared by design. Manual procedure documented for off-boarding. |

---

## 15. Reference

- [`NOTES-libsql-gotchas.md`](./NOTES-libsql-gotchas.md) — bun:sqlite ↔ libSQL differences, severity-tiered. Mandatory reading for Phase 1 implementers.
- [`AGENTS.md`](./AGENTS.md) — current project architecture (will be updated as Phase 0–4 land).
- [`CHANGELOG.md`](./CHANGELOG.md) — append entries under `## [Unreleased]` per project policy.

---

*End of plan v2. Ready for execution.*
