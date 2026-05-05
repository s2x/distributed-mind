# libSQL Implementation Gotchas

> **Status:** Live document capturing actual incidents and resolutions from Phase 0-4.
> Updated during implementation — each gotcha and workaround reflects real discoveries.

Practical differences and gotchas between `bun:sqlite` and `@libsql/client` encountered during libSQL backend implementation.

---

## 🔴 Critical (guaranteed bug if unhandled)

### 1. BigInt instead of `number` for INTEGER columns

- **bun:sqlite:** returns JS `number`.
- **libSQL:** returns `BigInt` for INTEGER by default; configurable via `intMode: 'number' | 'bigint' | 'string'` in `createClient()`.
- **Impact:** `memory.id`, `tier`, `access_count`, `pinned`, `source_id`/`target_id`. Direct comparisons like `tier === 1` return `false` against `BigInt(1)`. `JSON.stringify({ id })` throws on BigInt.
- **Resolution:** Set `intMode: 'number'` on the libSQL client. Verify no value exceeds `Number.MAX_SAFE_INTEGER` (our IDs are far below). Consider asserting at boundaries.

### 2. BLOB encoding for embeddings

- **bun:sqlite:** read/write Node `Buffer`.
- **libSQL:** read as `ArrayBuffer`/`Uint8Array`; write expects `Uint8Array`.
- **Impact:** `memories.embedding: Float32Array | null`. Round-trip Float32Array ↔ BLOB must be byte-identical between backends.
- **Resolution:** Per-backend helpers `floatArrayToBlob(arr)` / `blobToFloatArray(buf)`. Add a parametric round-trip test that asserts identical bytes after write/read on both backends.

### 3. Transactions: `db.transaction(() => {...})` vs `client.batch([...])`

- **bun:sqlite:** transaction is a **synchronous JS function** — supports conditional logic, loops, conditional INSERTs interleaved with reads.
- **libSQL:** `client.batch([{ sql, args }, ...], "write")` is a **pre-built statement list** — no JS logic between statements.
- **Impact:** `addMemory` (tier limit check + conditional LRU eviction), `patchMemory` (conditional FTS sync), tag-repository transactions, multi-step migrations.
- **Resolution:** Restructure each transaction into: (a) one read query to fetch state, (b) JS computation, (c) one batch with pre-built statements. Cannot port 1:1 — every transaction needs deliberate redesign.

### 4. `last_insert_rowid()` inside batches

- **bun:sqlite:** `db.run(sql)` returns `{ lastInsertRowid }` per INSERT.
- **libSQL:** `result.lastInsertRowid` (BigInt) on a single `execute()` result. Inside `batch([...])`, each result-array element exposes its own `lastInsertRowid`, but **you cannot reference it from a later SQL in the same batch** (statements are pre-built).
- **Impact:** Anywhere we INSERT a memory and then INSERT tags/links referencing the new ID.
- **Resolution:** Either (a) split into INSERT + read ID + follow-up batch (two round-trips), or (b) use `INSERT ... RETURNING id` (SQLite ≥ 3.35; libSQL supports it).

### 5. Boolean → INTEGER 0/1

- **Both backends:** SQLite has no native boolean; values are 0/1 INTEGER.
- **Difference:** bun:sqlite ecosystem sometimes auto-coerces; libSQL returns raw 0/1.
- **Impact:** `pinned`, `hidden`. `if (memory.pinned)` works (0/1 truthy), but `memory.pinned === true` does not.
- **Resolution:** Repository-level normalizer `boolFromInt(row.pinned)`. Apply on every read mapping.

---

## 🟡 Important (likely bug)

### 6. FTS5 MATCH parameter binding

- **bun:sqlite:** `db.query("... WHERE memories_fts MATCH ?").all(query)` works.
- **libSQL:** historical issues with MATCH via parameter binding — sometimes requires injecting as escaped literal.
- **Impact:** `search-repository.ts` (~623 lines, hot path).
- **Resolution:** Test parameter binding early in Phase 1. If it fails, fall back to literal injection with FTS5 query escaping (handle `*`, `"`, `-`, `OR`, `NEAR`, `AND`).

### 7. PRAGMA support — `journal_mode = WAL`, `foreign_keys`

- **bun:sqlite:** PRAGMAs explicit on connection; work on the local file.
- **libSQL embedded replica:** WAL is **implicit via the replication protocol**. Setting it manually is a no-op or error. `foreign_keys = ON` syntax may differ or be per-connection only.
- **Impact:** Plan already foresees splitting `SQLITE_PRAGMA_SQL` from portable schema. Verifying FK enforcement on the replica is **must-have** — the entire `ON DELETE CASCADE` chain depends on it.
- **Resolution:** E2E test: `DELETE FROM spaces WHERE name = 'X'` → memories, tags, links must vanish.

### 8. Error codes / exception types

- **bun:sqlite:** `SQLiteError` with codes like `SQLITE_CONSTRAINT_UNIQUE`.
- **libSQL:** `LibsqlError` with different code/message format.
- **Impact:** Every `try/catch` that inspects `e.code` or message. In our codebase: unique constraint validation on `(space_name, name)`, FK violation handling.
- **Resolution:** Per-backend helper `isUniqueConstraintError(e)`, `isFkViolation(e)`. Update test assertions that match error message strings.

### 9. `datetime('now')` drift across replicas

- **Both backends** support `datetime('now')`.
- **Difference:** each replica uses **its local process wall-clock**. With 30 devs across timezones, `changed_at` can go backwards (replica in UTC-8 wrote 10:00, replica in UTC+1 writes 11:00 for an *earlier* wall-clock event).
- **Impact:** `ORDER BY changed_at` in `query_memories`, trending memories in `space_get`, audit trail timestamps in `memory_history`.
- **Resolution:** Either `datetime('now', 'utc')` everywhere, or **generate timestamp in app code as UTC ISO and bind as parameter**. The second option is preferred — eliminates server-side time dependency entirely.

### 10. NULL vs undefined in result rows

- **bun:sqlite:** `db.query().get()` → `null` for NULL column, `undefined` for missing row.
- **libSQL:** `result.rows[0]` → `undefined` if no row; field is `null` if NULL. More consistent, but type definitions differ.
- **Impact:** Optional fields (`embedding`, `last_accessed_at`, `description`).
- **Resolution:** Audit type guards. Standardize on `result == null` checks (covers both `null` and `undefined`) where appropriate.

---

## 🟢 Watch-outs (niche but real)

### 11. Statement caching / performance

- **bun:sqlite:** `db.query(sql)` returns a cached prepared statement; reuse is cheap.
- **libSQL:** `client.execute()` is one-shot — prepare cost on every call. Hot loops pay round-trip cost.
- **Impact:** Performance regression possible in `search-repository.ts` if a query runs in a tight loop. Mind doesn't currently do this, but worth measuring after migration.

### 12. `db.exec(multistatementScript)` → batch split

- **bun:sqlite:** `db.exec(schema)` runs an entire `.sql` blob.
- **libSQL:** must split by `;` and run via `batch()`. Naive split breaks FTS5 schema where strings contain `;`.
- **Impact:** `initializeDatabase()` for libSQL backend.
- **Resolution:** Either store statements as discrete strings in code, or use a SQL-aware splitter. Avoid regex `.split(';')` on user-facing schema.

### 13. Foreign key CASCADE on embedded replica

- Plan assumes parity with bun:sqlite. **Requires verification** — WAL frame replication and runtime FK enforcement are different layers and can diverge.
- **Test:** integration test deleting a space and asserting cascade through memories, tags, links.

### 14. Initial sync time on first connection

- First `@libsql/client` connection with `syncUrl` set downloads the **full database** from the primary.
- For 30 devs × multi-MB brain × team-server bandwidth, this is non-zero.
- Plan does not mention this in rollout (§7.1). Add it: "first `dimind status` after setup may take 10s–60s depending on DB size."

### 15. Replica file format compatibility

- libSQL embedded replica writes **standard SQLite file format** — can be opened by `bun:sqlite` in read-only mode for debugging. Useful.
- **Reverse direction is NOT safe:** writing to the file via `bun:sqlite` while libSQL also has it open can corrupt WAL state. Never mix backends on the same file.

### 16. Schema migrations on the primary

- SQLite has limited ALTER TABLE. Plan says "fresh libSQL bases start at v7, no migrations needed."
- Future v8: requires **stopping writes + applying migration on primary + replicas pull new state**. No mid-flight schema changes — runbook needed before v8.

---

## Verification checklist (perform during Phase 1, not as a separate spike)

- [ ] BigInt → number conversion via `intMode` works for all INTEGER columns.
- [ ] BLOB round-trip Float32Array preserves bytes exactly (parametric test).
- [ ] FK CASCADE on space delete cascades through memories/tags/links/FTS.
- [ ] FTS5 MATCH binding works via parameter; if not, escape-and-inject path tested.
- [ ] `RETURNING id` works inside `batch()` and value is BigInt-normalizable.
- [ ] Unique constraint violation surfaces a recognizable error code/type.
- [ ] Schema initialization via `batch()` after `;`-aware splitter handles FTS5 stanza.
- [ ] All `datetime('now')` callsites either UTC-anchored or replaced by app-generated UTC ISO timestamps.
- [ ] App-level timestamps are stable across timezone-shifted replica processes (test with `TZ=UTC-8` and `TZ=UTC+1` simultaneously).

---

---

## Confirmed Implementation Findings (Phases 0-4)

### ✓ BigInt → Number Works (with intMode)

**Resolution:** Set `intMode: 'number'` in libSQL client config. All INTEGER columns return JavaScript Number type. Tested across memory ID, tier, access_count, pinned boolean columns.

### ✓ BLOB → ArrayBuffer (Not Uint8Array)

**Resolution:** Cast `result.embedding as ArrayBuffer | null`. Convert to Float32Array view when needed:
```typescript
const buf = result.embedding as ArrayBuffer | null;
if (buf) {
  const view = new Float32Array(buf);
}
```

### ✓ Multi-Statement Execute Fails

**Confirmed:** `execute()` cannot run multiple statements. Must split by `;` or use `batch()` for multiple statements.

**Resolution:** In schema init, split manually or use `batch()`:
```typescript
await db.batch([
  { sql: "CREATE TABLE spaces ...", args: [] },
  { sql: "CREATE TABLE memories ...", args: [] },
]);
```

### ✓ PRAGMA Before Batch

**Confirmed:** PRAGMA statements must run separately before batch or other operations.

**Resolution:**
```typescript
await db.execute("PRAGMA foreign_keys = ON");
// now safe to batch
await db.batch([...]);
```

### ✓ lastInsertRowid Always BigInt

**Confirmed:** Even with `intMode: 'number'`, `result.lastInsertRowid` is BigInt.

**Resolution:** Cast explicitly:
```typescript
const id = Number(result.lastInsertRowid);
```

### ✓ Boolean Columns Return 0/1

**Confirmed:** SQLite NUMERIC columns used for booleans (pinned, hidden) return raw 0 or 1, not true/false.

**Resolution:** Cast in code or use helper:
```typescript
const memory = {
  ...row,
  pinned: row.pinned === 1,
  hidden: row.hidden === 1
};
```

---

*Each finding was validated during implementation and applied to libsql-store.ts and libsql-repositories/*.ts.*
