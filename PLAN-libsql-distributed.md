# Distributed Mind — Migration & Rebranding Plan

> **Status:** Draft — awaiting execution go-ahead  
> **Target runtime:** Bun + `@libsql/client` (embedded replica)  
> **Team size:** 20–30 AI-assisted developers  
> **Concurrency model:** Offline-first, last-write-wins (LWW), optimistic sync every 30 s

---

## 1. Why we are doing this

### 1.1 The original `mind` was a personal CLI tool
The current codebase is a single-user, single-node SQLite application. It uses `bun:sqlite`, stores data in `./data/mind.db`, and assumes one developer on one machine. That design is excellent for a solo hacker, but it collapses the moment you want a **team of 20–30 developers** to share the same long-term memory.

### 1.2 What "distributed mind" actually means for us
We are not building a generic database. We are building a **team brain** that survives:
- **Laptops going offline** (commute, flights, coffee-shop Wi-Fi).
- **Simultaneous writes** (rare in practice because work is Jira-task-partitioned, but still possible).
- **New teammates joining mid-project** and needing the full history instantly.
- **No single point of failure** for the shared state (the local primary can be rebuilt from replicas).

### 1.3 Why libSQL (embedded replica + local `libsql-server`)
We evaluated three backends:

| Backend | Why it was considered | Why it was rejected |
|---------|----------------------|---------------------|
| **bun:sqlite** (status quo) | Zero deps, blazing fast | Single-node only. No sync. |
| **mvSQLite** (FoundationDB VFS) | True distributed SQLite, multi-writer MVCC | Requires dynamic `libsqlite3.so` or `LD_PRELOAD`. Bun embeds SQLite statically, so mvSQLite is **inaccessible from our runtime** without a custom Rust/C proxy. That is a separate project, not a migration. |
| **Turso Database** | Cloud-native, concurrent writes, bi-directional sync | Still in beta. We will migrate to it once it is stable, but we need something **production-ready today**. |
| **libSQL embedded replica** | Local SQLite file + transparent background sync to a `libsql-server` primary. Works offline. Sync interval configurable. Last-write-wins semantics. Fully supported by `@libsql/client`. | Single-writer lock on the primary (SQLite heritage). Acceptable for our use case because Jira-task partitioning makes concurrent edits of the *same* memory rare. |

**Decision:** We go with **libSQL embedded replica** now. It gives us 90 % of the value with 10 % of the effort. When Turso Database matures, we swap the `syncUrl` and get concurrent writes for free.

---

## 2. Rebranding: from `mind` to `distributed-mind`

### 2.1 Why rename?
The original name `mind` is ungoogleable, already taken on npm/registry, and implies a single brain. We are building a **swarm memory** — many agents (human + AI) feeding one distributed knowledge graph.

### 2.2 Candidates

| Name | Rationale | Risk |
|------|-----------|------|
| **distributed-mind** | Descriptive, explicit, matches repo name. | Long to type. |
| **dimind** | Short, pronounceable, memorable. | Slightly abstract; possible collision with "di-mind" or "dim mind". |
| **swarm-mind** | Emphasizes collective intelligence. | May sound too sci-fi/enterprise. |
| **memhive** | "Memory" + "hive". Short, unique, easy to brand. | Needs explanation on first contact. |

**Recommendation:** Use `distributed-mind` as the **project / repo / Docker image** name, and expose the CLI as `dimind` (shim: `./dimind` or `dimind` after global install). This follows the pattern of `docker` / `docker-compose`, `git` / `git-worktree`, etc.

### 2.3 What gets renamed
- GitHub repo: `distributed-mind` (already is).
- CLI binary / npm package name: `dimind`.
- Bash entry script: `mind` → `dimind` (with a backwards-compat symlink `mind → dimind` for one release cycle).
- Docker images: `distributed-mind:latest`.
- Internal module paths stay as-is (`src/mind.ts` can remain; it is the *engine*, not the brand).
- Environment variable prefix: `MIND_*` keeps working; we **add** `DIMIND_*` aliases and slowly deprecate `MIND_*` in docs.

---

## 3. Architecture after migration

```text
┌─────────────────────────────────────────────────────────────┐
│  Dev laptop (Bun runtime)                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  dimind CLI  /  dimind serve  /  dimind mcp        │    │
│  │  ┌─────────────────────────────────────────────┐   │    │
│  │  │  @libsql/client (embedded replica)          │   │    │
│  │  │  url: file:./data/dimind.db                 │   │    │
│  │  │  syncUrl: http://team-server:8080           │   │    │
│  │  │  syncInterval: 30000 ms                     │   │    │
│  │  └─────────────────────────────────────────────┘   │    │
│  │              │                                      │    │
│  │    ┌─────────┴──────────┐                          │    │
│  │    ▼                    ▼                          │    │
│  │  [local file]    [sync every 30 s]                 │    │
│  │  data/dimind.db        │                           │    │
│  │                        ▼                           │    │
│  │           ┌──────────────────┐                     │    │
│  │           │ libsql-server    │  ◄─── other devs    │    │
│  │           │ team-server:8080 │                     │    │
│  │           └──────────────────┘                     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Key properties**
- **Offline-first:** Every read and write hits the local file. Zero latency.
- **Background sync:** The `@libsql/client` library pushes local WAL frames to the primary and pulls new frames from it on a timer.
- **Conflict resolution:** Last-write-wins at the frame level. Because our workload is Jira-task-partitioned, conflicts are rare.
- **Audit trail:** Application-level `memory_history` table lets us see who changed what and revert if LWW ever bites us.
- **No schema migrations on the primary:** New bases start at schema v7. Legacy SQLite users migrate manually (export/import).

---

## 4. Environment variables

| Variable | Required | Default | Meaning |
|----------|----------|---------|---------|
| `DIMIND_DATABASE_URL` | No | `file:./data/dimind.db` | Local embedded-replica path. Must start with `file:`. |
| `DIMIND_SYNC_URL` | No | — | Primary `libsql-server` URL (e.g. `http://team-server:8080`). If absent, app works in **solo offline mode** (no sync). |
| `DIMIND_SYNC_INTERVAL` | No | `30000` | Sync interval in milliseconds. |
| `DIMIND_SYNC_AUTH_TOKEN` | No | — | JWT or basic auth token for the primary. Empty for unauthenticated local `sqld`. |
| `DIMIND_DATA_DIR` | No | `./data` | Legacy fallback directory when `DIMIND_DATABASE_URL` is not set. |

**Backwards compatibility:** If `DIMIND_DATABASE_URL` is absent, the app falls back to legacy `bun:sqlite` using `DIMIND_DATA_DIR/dimind.db` (or the old `MIND_DATA_DIR/mind.db`). This ensures existing solo users are not broken.

---

## 5. Implementation phases

### Phase 0 — Async `MindStore` refactor

**Goal:** Make the `MindStore` interface fully asynchronous so it can accommodate both `bun:sqlite` (synchronous under the hood, but wrapped) and `@libsql/client` (natively async).

**Why this must happen first:**
`@libsql/client` has no synchronous API. If we keep `MindStore` synchronous, we would have to block the Bun event loop on every DB call, destroying throughput and composability. Making the interface `async` is a mechanical, zero-logic change that unlocks everything else.

**What changes:**
- `src/store/mind-store.ts` — every method signature becomes `Promise<T>`.
- `src/store/sqlite-store.ts` — all methods become `async`, returning `Promise.resolve(...)` around existing `bun:sqlite` calls.
- `src/store/repositories/*.ts` — same treatment. No SQL changes.
- `src/cli/command-executor.ts`, `src/cli/commands/*.ts` — add `await` before every store call.
- `src/api/server.ts`, `src/api/routes/*.ts` — add `await`.
- `src/mcp/server.ts`, `src/mcp/handlers/*.ts` — add `await`.
- `test/mocks/test-store.ts`, `test/*.spec.ts` — update to `await`.

**Validation:** `bun test` must pass with exactly the same assertions. No behavioural changes.

**Estimated effort:** 2–3 h.

---

### Phase 1 — libSQL store + repositories

**Goal:** Implement a second `MindStore` backend using `@libsql/client` with embedded-replica support.

**New files:**
- `src/store/libsql-store.ts` — `createLibsqlStore(config)` factory.
- `src/store/libsql-repositories/space-repository.ts`
- `src/store/libsql-repositories/memory-repository.ts`
- `src/store/libsql-repositories/tag-repository.ts`
- `src/store/libsql-repositories/link-repository.ts`
- `src/store/libsql-repositories/search-repository.ts`
- `src/store/libsql-repositories/log-repository.ts`

**Key implementation notes:**

| bun:sqlite idiom | libSQL equivalent |
|------------------|-------------------|
| `db.query(sql).get(...args)` | `await client.execute({ sql, args }).then(r => r.rows[0])` |
| `db.query(sql).all(...args)` | `await client.execute({ sql, args }).then(r => r.rows)` |
| `db.run(sql, args)` | `await client.execute({ sql, args })` |
| `db.transaction(() => { ... })()` | `await client.batch([{ sql, args }, ...], "write")` |
| `SELECT last_insert_rowid()` | `resultSet.lastInsertRowid` (property on the result object) |
| `db.exec(schemaSql)` | Split schema into individual statements and run `client.batch(..., "write")` |
| `Float32Array` from BLOB | `new Float32Array(resultRow[0].buffer)` (libSQL returns `ArrayBuffer`) |

**Schema handling:**
- `src/store/schema.ts` splits into:
  - `SCHEMA_SQL` — portable SQL (tables, indexes, FTS5). Used by both backends.
  - `SQLITE_PRAGMA_SQL` — `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, etc. Used **only** by `sqlite-store.ts`.
- `initializeDatabase(db)` gets a libSQL variant `initializeLibsqlDatabase(client)` that skips PRAGMA and runs schema via `batch()`.
- **No legacy migrations on libSQL.** A fresh libSQL base starts at schema v7. Existing SQLite users who want to join the team primary export to SQL/JSON and re-import.

**Validation:**
- `test/libsql-store.spec.ts` — instantiate a temporary `file:/tmp/dimind-test-${uuid}.db`, run the full `MindStore` test suite against it.
- `bun test test/libsql-store.spec.ts` must pass.

**Estimated effort:** 5–7 h.

---

### Phase 2 — Factory, Docker, and configuration wiring

**Goal:** Make the backend selectable at runtime, ship a `libsql-server` container for the team, and wire all config.

**Factory (`src/store/factory.ts`):**
```ts
export async function createStore(): Promise<MindStore> {
  const dbUrl = process.env.DIMIND_DATABASE_URL;

  if (dbUrl?.startsWith('file:')) {
    return createLibsqlStore({
      url: dbUrl,
      syncUrl: process.env.DIMIND_SYNC_URL,
      syncInterval: parseInt(process.env.DIMIND_SYNC_INTERVAL || '30000', 10),
      authToken: process.env.DIMIND_SYNC_AUTH_TOKEN,
    });
  }

  // Legacy solo mode
  return createSqliteStore(CONFIG.dbPath);
}
```

**Docker Compose (`docker-compose.libsql.yml`):**
```yaml
services:
  libsql-primary:
    image: ghcr.io/tursodatabase/libsql-server:latest
    platform: linux/amd64
    ports:
      - "8080:8080"
      - "5001:5001"
    volumes:
      - ./data/libsql-primary:/var/lib/sqld
    environment:
      - SQLD_NODE=primary
```

**Config (`src/config.ts`):**
- Add `databaseUrl`, `syncUrl`, `syncInterval`, `syncAuthToken`.
- Keep `dbPath` for legacy mode.
- Resolution order:
  1. `DIMIND_DATABASE_URL`
  2. `DIMIND_DATA_DIR` + `dimind.db`
  3. `./data/dimind.db`

**Validation:**
- `docker compose -f docker-compose.libsql.yml up -d`
- `DIMIND_SYNC_URL=http://localhost:8080 bun test test/sync-integration.spec.ts`
- Two clients write to the same primary, sync, and see each other's data.

**Estimated effort:** 2–3 h.

---

### Phase 3 — Audit trail & revert (soft history)

**Goal:** Mitigate the rare but real danger of LWW conflicts by keeping an application-level history log. This is not a CRDT — it is a safety net.

**Why not full event sourcing?**
Event sourcing would require rewriting ~60 % of the store layer, adding aggregate rebuild logic, and teaching the UI to render event streams. Our conflict rate is low (Jira-task partitioning), so the cost/benefit ratio is terrible. A simple history table gives us 80 % of the safety for 5 % of the effort.

**Schema addition (both backends):**
```sql
CREATE TABLE IF NOT EXISTS memory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER NOT NULL,
  space_name TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,              -- JSON array snapshot
  tier INTEGER,
  changed_by TEXT,        -- hostname, USER env, or git user
  changed_at TEXT DEFAULT (datetime('now')),
  operation TEXT          -- 'update' | 'delete'
);
CREATE INDEX idx_memory_history_memory_id ON memory_history(memory_id);
CREATE INDEX idx_memory_history_changed_at ON memory_history(changed_at);
```

**Store changes:**
- `updateMemory` — before `UPDATE memories ...`, run `INSERT INTO memory_history (...) SELECT ... FROM memories WHERE id = ?`.
- `deleteMemory` — before `DELETE`, snapshot to `memory_history` with `operation = 'delete'`.
- `patchMemory` — same as `updateMemory`.

**New CLI commands:**
- `dimind history <space> <memory>` — list last N versions (default 10).
- `dimind revert <space> <memory> --to <history_id>` — copy row from `memory_history` back to `memories`, then add a new history entry `operation = 'revert'`.

**Validation:**
- `test/history.spec.ts` — update, delete, revert, verify content resurrection.

**Estimated effort:** 2–3 h.

---

## 6. What is deliberately out of scope

We are ruthlessly pruning to ship a working team memory in days, not weeks.

| Feature | Why it is out of scope | When it might return |
|---------|------------------------|----------------------|
| **mvSQLite backend** | Incompatible with Bun's statically-linked SQLite. Would require a Rust/C HTTP proxy — a separate project. | If someone builds a stable `mvsqlite-http-gateway` or Bun adds dynamic VFS loading. |
| **Turso Database backend** | Still in beta. Not production-ready today. | Once Turso Database hits GA, we swap the `syncUrl` and gain concurrent writes for free. |
| **CRDT / event sourcing** | Overkill for our conflict rate. Jira-task partitioning means 99 % of writes are to distinct memories. | If we ever add real-time collaborative editing of a single memory (e.g. live spec writing). |
| **Native libSQL vector search** | Our RAG pipeline already works with JS `cosineSimilarity` over BLOBs. Migrating to `libsql_vector` is a nice-to-have optimisation, not a blocker. | Phase 4 optimisation, once benchmarks show JS similarity is a bottleneck. |
| **Automatic SQLite → libSQL migration** | One-time cost for legacy users. We provide `dimind export` and `dimind import` commands. | If user demand is high, we can script a SQL dump + load into libSQL replica later. |
| **Real-time sync (< 1 s)** | libSQL embedded replica has a minimum practical sync interval. Sub-second would require WebSocket push or polling, adding complexity. | Turso Database promises this natively. |

---

## 7. Rollout strategy for the team

### 7.1 New teammate onboarding

```bash
# 1. Clone
git clone git@github.com:our-org/distributed-mind.git
cd distributed-mind
bun install

# 2. Configure
cp .env.example .env
# Edit .env:
#   DIMIND_SYNC_URL=http://team-server:8080
#   DIMIND_SYNC_INTERVAL=30000

# 3. First run — creates local replica and pulls full team memory
./dimind status

# 4. Done. Work offline, sync happens automatically.
```

### 7.2 Legacy solo user migrating to team mode

```bash
# 1. Export existing solo brain
./dimind export > my-brain.json

# 2. Switch env to team primary
cp .env.team .env

# 3. Import into the new replica (writes to local file, syncs up to primary)
./dimind import < my-brain.json
```

### 7.3 Backwards-compat shim

For one release cycle we keep a `mind` symlink pointing to `dimind`, and honour `MIND_*` environment variables as aliases for `DIMIND_*`. Deprecation warnings are printed but do not fail.

---

## 8. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Async refactor breaks CLI** | Low | High | Purely mechanical change. `bun test` catches missing `await` immediately. |
| **libSQL `batch()` behaves differently from `bun:sqlite` transactions** | Medium | High | We use `batch(..., "write")` for all multi-statement operations. Tests cover tier eviction, FTS sync, and link consistency. |
| **FTS5 tokenizer mismatch between local replica and primary** | Low | Medium | Both run libSQL (same fork). `porter unicode61` is supported identically. |
| **LWW overwrites a teammate's edit** | Low (Jira partitioning) | Medium | Application-level `memory_history` + `revert` command. Ops team can also increase sync frequency if needed. |
| **Primary `sqld` container dies** | Medium | High | Local replicas keep working offline. Primary is stateful but can be restored from any replica's local file (libSQL file format is standard SQLite). Regular backups of `./data/libsql-primary` via `docker volume` or simple `cp`. |
| **Schema v7 assumptions fail on libSQL** | Low | High | Fresh libSQL bases start at v7. We test `test/libsql-store.spec.ts` end-to-end before shipping. |

---

## 9. Definition of done

- [ ] `bun test` passes for legacy `sqlite-store.ts` (zero regressions).
- [ ] `bun test test/libsql-store.spec.ts` passes (new backend).
- [ ] `bun test test/sync-integration.spec.ts` passes (two clients, one primary, LWW observed).
- [ ] `bun test test/history.spec.ts` passes (audit + revert).
- [ ] `docker compose -f docker-compose.libsql.yml up` spins up a working primary.
- [ ] `./dimind` binary exists and responds to `--version`.
- [ ] `MIND_*` env vars still work with a deprecation warning.
- [ ] `AGENTS.md` and `CHANGELOG.md` updated.
- [ ] New dev can clone, `bun install`, set `DIMIND_SYNC_URL`, and see team memories within 60 seconds.

---

## 10. Appendix: name decision log

**Chosen public name:** `distributed-mind` (repo, Docker image, docs).  
**Chosen CLI name:** `dimind` (short, memorable, distinct from existing tools).  
**Backwards-compat alias:** `mind → dimind` (one release cycle).

Rationale against alternatives:
- `swarm-mind` — too abstract, sounds like a blockchain project.
- `memhive` — cute, but nobody knows what it does without explanation.
- `dimind` alone as repo name — ambiguous spelling ("dim mind" vs "di-mind").

The combination `distributed-mind` / `dimind` gives us a clear brand *and* a short daily command.

---

*End of plan. Ready for execution upon approval.*
