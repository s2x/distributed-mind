// ── SQLite implementation of MindStore ──

import { existsSync, statSync, copyFileSync, unlinkSync } from 'fs';

import { Database } from 'bun:sqlite';

import { TIER_LIMITS } from '../config';
import {
  isRagEnabled,
  getEmbedding,
  semanticSearch,
  blobToVector,
  vectorToBlob,
} from '../helpers/rag';
import { normalizeTag, normalizeTags } from '../helpers/tags';
import type {
  Space,
  SpaceSummary,
  Memory,
  MemorySummary,
  Link,
  Tier,
  HotMemorySummary,
  SearchFilter,
  MemoryQueryFilter,
  SearchResult,
  StatusResult,
  SpaceGraphResult,
  LegacyBrain,
} from '../types';

import type { LinkedMemorySummary, MemoryPatchInput, MindStore } from './mind-store';
import { initializeDatabase } from './schema';

/**
 * Run a quick integrity check and attempt FTS rebuild if the database is corrupted.
 * Returns true if the database is usable, false if unrecoverable.
 */
function ensureIntegrity(db: Database, dbPath: string): boolean {
  try {
    const result = db.query('PRAGMA quick_check(1)').get() as { quick_check: string } | null;
    if (result?.quick_check === 'ok') return true;
  } catch {
    // quick_check itself failed — DB is definitely corrupted
  }

  // Attempt FTS rebuild first (most common corruption source with manual FTS sync)
  try {
    console.error('[mind] Database corruption detected, attempting FTS rebuild...');
    db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");
    const recheck = db.query('PRAGMA quick_check(1)').get() as { quick_check: string } | null;
    if (recheck?.quick_check === 'ok') {
      console.error('[mind] FTS rebuild succeeded, database recovered.');
      return true;
    }
  } catch {
    // FTS rebuild failed too
  }

  // Last resort: backup corrupt file and start fresh
  const backupPath = `${dbPath}.corrupt.${Date.now()}`;
  try {
    console.error(
      `[mind] FTS rebuild failed. Backing up corrupt DB to ${backupPath} and starting fresh.`
    );
    db.close();
    copyFileSync(dbPath, backupPath);
    // Remove WAL/SHM files too
    for (const suffix of ['-wal', '-shm']) {
      const walPath = `${dbPath}${suffix}`;
      if (existsSync(walPath)) unlinkSync(walPath);
    }
    unlinkSync(dbPath);
  } catch (e) {
    console.error(`[mind] Failed to backup corrupt database: ${e}`);
  }
  return false;
}

export function createSqliteStore(dbPath: string): MindStore {
  let db = new Database(dbPath, { create: true });
  initializeDatabase(db);

  if (!ensureIntegrity(db, dbPath)) {
    // Corrupt DB was backed up and removed — create fresh
    db = new Database(dbPath, { create: true });
    initializeDatabase(db);
  }

  // ── Helpers ──

  function now(): string {
    return new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
  }

  function normalizeDateBound(raw: string, endOfDay = false): string {
    const text = raw.trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const parsed = dateOnly
      ? new Date(`${text}T${endOfDay ? '23:59:59' : '00:00:00'}`)
      : new Date(text);

    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid date value: ${raw}`);
    }

    return parsed.toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
  }

  // ── Manual FTS sync (bun:sqlite has a bug with content-sync triggers) ──

  function ftsInsert(id: number, name: string, content: string): void {
    db.run('INSERT INTO memories_fts(rowid, name, content) VALUES (?, ?, ?)', [id, name, content]);
  }

  function ftsDelete(id: number): void {
    db.run('DELETE FROM memories_fts WHERE rowid = ?', [id]);
  }

  function ftsUpdate(id: number, name: string, content: string): void {
    ftsDelete(id);
    ftsInsert(id, name, content);
  }

  function getTagsForMemory(memoryId: number): string[] {
    const rows = db.query('SELECT tag FROM memory_tags WHERE memory_id = ?').all(memoryId) as {
      tag: string;
    }[];
    return rows.map(r => r.tag);
  }

  function getTagsForSpace(spaceName: string): string[] {
    const rows = db.query('SELECT tag FROM space_tags WHERE space_name = ?').all(spaceName) as {
      tag: string;
    }[];
    return rows.map(r => r.tag);
  }

  function rowToMemory(row: any): Memory {
    return {
      id: row.id,
      space_name: row.space_name,
      name: row.name,
      content: row.content,
      tier: row.tier as Tier,
      pinned: row.pinned === 1,
      access_count: row.access_count,
      last_accessed_at: row.last_accessed_at,
      embedding: row.embedding ? blobToVector(row.embedding) : null,
      tags: getTagsForMemory(row.id),
      created_at: row.created_at,
      updated_at: row.updated_at,
      changed_at: row.changed_at,
    };
  }

  function requireSpace(name: string): void {
    const row = db.query('SELECT 1 FROM spaces WHERE name = ?').get(name);
    if (!row)
      throw new Error(`Space "${name}" does not exist. Create it first with space_create tool.`);
  }

  function requireMemory(id: number): any {
    const row = db.query('SELECT * FROM memories WHERE id = ?').get(id);
    if (!row)
      throw new Error(
        `Memory with id ${id} does not exist. Use memory_query or search to find valid IDs.`
      );
    return row;
  }

  // ── LRU / Capacity helpers ──

  /**
   * Count all memories (pinned + non-pinned) at a given tier in a space.
   * Limits are applied to ALL memories in a tier; pinned memories cannot be evicted.
   */
  function countTierTotal(space: string, tier: number): number {
    const row = db
      .query('SELECT COUNT(*) as c FROM memories WHERE space_name = ? AND tier = ?')
      .get(space, tier) as { c: number };
    return row.c;
  }

  /**
   * Ensure a tier has capacity for one more memory.
   * If the tier is full, evicts the LRU non-pinned memory to the next tier (no cascading).
   * T3 is unlimited — always returns true.
   * @param throwOnFull - if true, throws when tier is full and all are pinned; if false, returns false
   * @returns true if there is (or was made) capacity, false if no evictable memory
   */
  function ensureCapacity(
    space: string,
    tier: number,
    throwOnFull: boolean,
    touchChangedAt = true
  ): boolean {
    const limit = TIER_LIMITS[tier as 1 | 2];
    if (limit === undefined) return true; // T3: unlimited

    const total = countTierTotal(space, tier);
    if (total < limit) return true; // room available

    // Tier is full — find LRU non-pinned to evict
    const lru = db
      .query(
        `SELECT id FROM memories
                 WHERE space_name = ? AND tier = ? AND pinned = 0
                 ORDER BY COALESCE(last_accessed_at, created_at) ASC
                 LIMIT 1`
      )
      .get(space, tier) as { id: number } | null;

    if (!lru) {
      if (throwOnFull) {
        throw new Error(
          `T${tier} is full (${limit}/space) and all memories are pinned. Unpin one to make room.`
        );
      }
      return false;
    }

    // Evict LRU one tier down (no cascading — T3 is unlimited, no eviction needed)
    const nextTier = tier + 1;
    const ts = now();
    if (touchChangedAt) {
      db.run('UPDATE memories SET tier = ?, updated_at = ?, changed_at = ? WHERE id = ?', [
        nextTier,
        ts,
        ts,
        lru.id,
      ]);
    } else {
      db.run('UPDATE memories SET tier = ?, updated_at = ? WHERE id = ?', [nextTier, ts, lru.id]);
    }
    return true;
  }

  // ── Spaces ──

  function createSpace(name: string, description: string, tags?: string[]): void {
    if (!tags || tags.length === 0) {
      throw new Error('Tags are required and cannot be empty');
    }

    const existing = db.query('SELECT 1 FROM spaces WHERE name = ?').get(name);
    if (existing) throw new Error(`Space "${name}" already exists`);

    const ts = now();
    db.run('INSERT INTO spaces (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      name,
      description,
      ts,
      ts,
    ]);

    if (tags && tags.length > 0) {
      const normalizedTags = normalizeTags(tags);
      const stmt = db.prepare('INSERT OR IGNORE INTO space_tags (space_name, tag) VALUES (?, ?)');
      for (const tag of normalizedTags) {
        stmt.run(name, tag);
      }
    }
  }

  function getSpace(name: string): Space | null {
    const row = db.query('SELECT * FROM spaces WHERE name = ?').get(name) as any;
    if (!row) return null;
    return {
      name: row.name,
      description: row.description,
      hidden: row.hidden === 1,
      tags: getTagsForSpace(row.name),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  function listSpaces(filter?: { tag?: string; includeHidden?: boolean }): SpaceSummary[] {
    let sql: string;
    let params: any[];

    const includeHidden = filter?.includeHidden ?? false;

    if (filter?.tag) {
      const normalizedFilter = normalizeTag(filter.tag);
      sql = `
                SELECT s.name, s.description, s.hidden,
                       (SELECT COUNT(*) FROM memories m WHERE m.space_name = s.name) AS memory_count
                FROM spaces s
                JOIN space_tags st ON st.space_name = s.name AND st.tag = ?
                ${includeHidden ? '' : 'WHERE s.hidden = 0'}
                ORDER BY s.name
            `;
      params = [normalizedFilter];
    } else {
      sql = `
                SELECT s.name, s.description, s.hidden,
                       (SELECT COUNT(*) FROM memories m WHERE m.space_name = s.name) AS memory_count
                FROM spaces s
                ${includeHidden ? '' : 'WHERE s.hidden = 0'}
                ORDER BY s.name
            `;
      params = [];
    }

    const rows = db.query(sql).all(...params) as any[];
    return rows.map(r => ({
      name: r.name,
      description: r.description,
      hidden: r.hidden === 1,
      tags: getTagsForSpace(r.name),
      memory_count: r.memory_count,
    }));
  }

  function updateSpace(name: string, updates: { description?: string; hidden?: boolean }): void {
    requireSpace(name);
    if (updates.description !== undefined) {
      db.run('UPDATE spaces SET description = ?, updated_at = ? WHERE name = ?', [
        updates.description,
        now(),
        name,
      ]);
    }
    if (updates.hidden !== undefined) {
      db.run('UPDATE spaces SET hidden = ?, updated_at = ? WHERE name = ?', [
        updates.hidden ? 1 : 0,
        now(),
        name,
      ]);
    }
  }

  function deleteSpace(name: string): void {
    requireSpace(name);
    // Clean FTS entries before cascade delete removes memories
    const mems = db.query('SELECT id FROM memories WHERE space_name = ?').all(name) as {
      id: number;
    }[];
    for (const m of mems) ftsDelete(m.id);
    db.run('DELETE FROM spaces WHERE name = ?', [name]);
  }

  function renameSpace(oldName: string, newName: string): void {
    requireSpace(oldName);
    const existing = db.query('SELECT 1 FROM spaces WHERE name = ?').get(newName);
    if (existing) throw new Error(`Space "${newName}" already exists`);
    db.run('UPDATE spaces SET name = ?, updated_at = ? WHERE name = ?', [newName, now(), oldName]);
  }

  function addSpaceTag(space: string, tag: string): void {
    requireSpace(space);
    const normalized = normalizeTag(tag);
    db.run('INSERT OR IGNORE INTO space_tags (space_name, tag) VALUES (?, ?)', [space, normalized]);
  }

  function removeSpaceTag(space: string, tag: string): void {
    requireSpace(space);
    const normalized = normalizeTag(tag);
    db.run('DELETE FROM space_tags WHERE space_name = ? AND tag = ?', [space, normalized]);
  }

  // ── Memories ──

  async function addMemory(
    space: string,
    name: string,
    content: string,
    opts?: { tags?: string[]; tier?: Tier; pinned?: boolean; linksToIds?: number[] }
  ): Promise<Memory> {
    requireSpace(space);

    if (!opts?.tags || opts.tags.length === 0) {
      throw new Error('Tags are required and cannot be empty');
    }

    const existing = db
      .query('SELECT 1 FROM memories WHERE space_name = ? AND name = ?')
      .get(space, name);
    if (existing) throw new Error(`Memory "${name}" already exists in space "${space}"`);

    const tier = opts?.tier ?? 2;
    const pinned = opts?.pinned ?? false;
    const linksToIds = opts?.linksToIds ?? [];

    for (const targetId of linksToIds) {
      const target = db.query('SELECT 1 FROM memories WHERE id = ?').get(targetId);
      if (!target) {
        throw new Error(
          `Cannot add memory: linked memory id ${targetId} does not exist. Use memory_query or search to find valid IDs.`
        );
      }
    }

    const addMemoryTransaction = db.transaction(() => {
      // Ensure capacity at target tier (evict LRU if needed); T3 is unlimited
      ensureCapacity(space, tier, true);

      const ts = now();
      const result = db.run(
        `INSERT INTO memories (space_name, name, content, tier, pinned, created_at, updated_at, changed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [space, name, content, tier, pinned ? 1 : 0, ts, ts, ts]
      );

      const id = Number(result.lastInsertRowid);
      ftsInsert(id, name, content);

      if (opts?.tags && opts.tags.length > 0) {
        const normalizedTags = normalizeTags(opts.tags);
        const stmt = db.prepare('INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)');
        for (const tag of normalizedTags) {
          stmt.run(id, tag);
        }
      }

      if (linksToIds.length > 0) {
        const linkStmt = db.prepare(
          'INSERT OR REPLACE INTO links (source_id, target_id, label, created_at) VALUES (?, ?, ?, ?)'
        );
        for (const targetId of linksToIds) {
          if (targetId === id) {
            throw new Error('Cannot add memory: add_links_to_ids cannot include self links.');
          }
          linkStmt.run(id, targetId, 'related', ts);
        }
      }

      return id;
    });

    const id = addMemoryTransaction();

    // Generate embedding if RAG is enabled (await so embedding is ready before process exits)
    if (isRagEnabled()) {
      const embedding = await getEmbedding(`${name} ${content}`);
      if (embedding) {
        db.run('UPDATE memories SET embedding = ? WHERE id = ?', [vectorToBlob(embedding), id]);
      }
    }

    return rowToMemory(db.query('SELECT * FROM memories WHERE id = ?').get(id) as any);
  }

  function getMemory(space: string, name: string): Memory | null {
    const row = db
      .query('SELECT * FROM memories WHERE space_name = ? AND name = ?')
      .get(space, name) as any;
    if (!row) return null;
    return rowToMemory(row);
  }

  function getMemoryById(id: number): Memory | null {
    const row = db.query('SELECT * FROM memories WHERE id = ?').get(id) as any;
    if (!row) return null;
    return rowToMemory(row);
  }

  function listMemories(space: string, filter?: { tier?: Tier; tag?: string }): MemorySummary[] {
    requireSpace(space);

    let sql =
      'SELECT m.id, m.space_name, m.name, m.tier, m.pinned, m.access_count, m.created_at, m.updated_at, m.changed_at FROM memories m';
    const joinParams: any[] = [];
    const conditions: string[] = ['m.space_name = ?'];
    const whereParams: any[] = [space];

    if (filter?.tag) {
      const normalizedFilter = normalizeTag(filter.tag);
      sql += ' JOIN memory_tags mt ON mt.memory_id = m.id AND mt.tag = ?';
      joinParams.push(normalizedFilter);
    }

    if (filter?.tier !== undefined) {
      // Explicit tier filter: T4 has been removed
      if (filter.tier === 4) {
        throw new Error('T4 has been removed; use tier 1, 2, or 3');
      }
      conditions.push('m.tier = ?');
      whereParams.push(filter.tier);
    } else {
      // Default: show T1 + T2 only (active memories)
      conditions.push('m.tier IN (1, 2)');
    }

    sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY m.tier ASC, m.access_count DESC, m.name ASC';

    const params = [...joinParams, ...whereParams];
    const rows = db.query(sql).all(...params) as any[];
    return rows.map(r => ({
      id: r.id,
      space_name: r.space_name,
      name: r.name,
      tier: r.tier as Tier,
      pinned: r.pinned === 1,
      tags: getTagsForMemory(r.id),
      access_count: r.access_count,
      created_at: r.created_at,
      updated_at: r.updated_at,
      changed_at: r.changed_at,
    }));
  }

  function getHotMemories(space: string): HotMemorySummary[] {
    const rows = db
      .query(
        `SELECT id, name, tier, pinned, updated_at
                 FROM memories
                 WHERE space_name = ? AND tier IN (1, 2)
                 ORDER BY tier ASC, name ASC`
      )
      .all(space) as { id: number; name: string; tier: Tier; pinned: number; updated_at: string }[];

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      tier: r.tier,
      tags: getTagsForMemory(r.id),
      pinned: r.pinned === 1,
      updated_at: r.updated_at,
    }));
  }

  function resolveMemoryRef(ref: string): { space: string; name: string } | null {
    const idx = ref.indexOf(':');
    if (idx <= 0) return null;
    const space = ref.slice(0, idx);
    const name = ref.slice(idx + 1);
    if (!space || !name) return null;
    return { space, name };
  }

  async function updateMemory(
    id: number,
    updates: { name?: string; content?: string }
  ): Promise<void> {
    const row = requireMemory(id);
    const ts = now();
    const sets: string[] = ['updated_at = ?', 'changed_at = ?'];
    const params: any[] = [ts, ts];

    if (updates.name !== undefined) {
      sets.push('name = ?');
      params.push(updates.name);
    }
    if (updates.content !== undefined) {
      sets.push('content = ?');
      params.push(updates.content);
    }

    params.push(id);
    db.run(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`, params);

    // Sync FTS if name or content changed
    if (updates.name !== undefined || updates.content !== undefined) {
      ftsUpdate(id, updates.name ?? row.name, updates.content ?? row.content);
    }

    // Regenerate embedding if RAG is enabled (await so embedding is ready before process exits)
    if (isRagEnabled() && (updates.name !== undefined || updates.content !== undefined)) {
      const memory = rowToMemory(db.query('SELECT * FROM memories WHERE id = ?').get(id) as any);
      const embedding = await getEmbedding(`${memory.name} ${memory.content}`);
      if (embedding) {
        db.run('UPDATE memories SET embedding = ? WHERE id = ?', [vectorToBlob(embedding), id]);
      }
    }
  }

  function deleteMemory(id: number): void {
    requireMemory(id);
    ftsDelete(id);
    db.run('DELETE FROM memories WHERE id = ?', [id]);
  }

  function deleteMemoryByName(space: string, name: string): void {
    const mem = getMemory(space, name);
    if (!mem) throw new Error(`Memory "${name}" not found in space "${space}"`);
    ftsDelete(mem.id);
    db.run('DELETE FROM memories WHERE id = ?', [mem.id]);
  }

  function recordAccess(id: number): void {
    const row = requireMemory(id);
    const ts = now();

    // Always bump access count and timestamp
    db.run(
      'UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?, updated_at = ? WHERE id = ?',
      [ts, ts, id]
    );

    // Auto-promote one tier up — skip if pinned or already at T1
    if (row.pinned || row.tier <= 1) return;

    const toTier = row.tier - 1;
    // Silently skip if destination is full and all are pinned (throwOnFull = false)
    const ok = ensureCapacity(row.space_name, toTier, false, false);
    if (ok) {
      db.run('UPDATE memories SET tier = ?, updated_at = ? WHERE id = ?', [toTier, ts, id]);
    }
  }

  function getLinkedMemorySummaries(memoryId: number): {
    links_to: LinkedMemorySummary[];
    linked_by: LinkedMemorySummary[];
  } {
    requireMemory(memoryId);

    const linksToRows = db
      .query(
        `SELECT m.id, m.name, m.space_name, m.changed_at, m.tier, m.pinned
                 FROM links l
                 JOIN memories m ON m.id = l.target_id
                 WHERE l.source_id = ?
                 ORDER BY m.changed_at DESC, m.id DESC`
      )
      .all(memoryId) as any[];

    const linkedByRows = db
      .query(
        `SELECT m.id, m.name, m.space_name, m.changed_at, m.tier, m.pinned
                 FROM links l
                 JOIN memories m ON m.id = l.source_id
                 WHERE l.target_id = ?
                 ORDER BY m.changed_at DESC, m.id DESC`
      )
      .all(memoryId) as any[];

    const toSummary = (row: any): LinkedMemorySummary => ({
      id: row.id,
      name: row.name,
      space_name: row.space_name,
      changed_at: row.changed_at,
      tier: row.tier as Tier,
      tags: getTagsForMemory(row.id),
      pinned: row.pinned === 1,
    });

    return {
      links_to: linksToRows.map(toSummary),
      linked_by: linkedByRows.map(toSummary),
    };
  }

  async function patchMemory(id: number, patch: MemoryPatchInput): Promise<Memory> {
    requireMemory(id);

    const hasAnyOperation =
      patch.name !== undefined ||
      patch.content !== undefined ||
      patch.pinned !== undefined ||
      patch.tierTransition !== undefined ||
      (patch.addTags?.length ?? 0) > 0 ||
      (patch.removeTags?.length ?? 0) > 0 ||
      (patch.addLinksToIds?.length ?? 0) > 0 ||
      (patch.removeLinksToIds?.length ?? 0) > 0;

    if (!hasAnyOperation) {
      throw new Error(
        'Provide at least one operation: name, content, pinned, tier_transition, add_tags, remove_tags, add_links_to_ids, or remove_links_to_ids.'
      );
    }

    if (patch.tierTransition === 'promote') {
      const current = requireMemory(id);
      if (current.tier <= 1) {
        throw new Error('Cannot promote memory: already at T1.');
      }
    }

    if (patch.tierTransition === 'demote') {
      const current = requireMemory(id);
      if (current.tier >= 3) {
        throw new Error('Cannot demote memory: already at the lowest tier.');
      }
    }

    for (const targetId of patch.addLinksToIds ?? []) {
      if (targetId === id) {
        throw new Error('Cannot patch memory: add_links_to_ids cannot include self links.');
      }
      const target = db.query('SELECT 1 FROM memories WHERE id = ?').get(targetId);
      if (!target) {
        throw new Error(
          `Cannot patch memory: linked memory id ${targetId} does not exist. Use memory_query or search to find valid IDs.`
        );
      }
    }

    for (const targetId of patch.removeLinksToIds ?? []) {
      if (targetId === id) {
        throw new Error('Cannot patch memory: remove_links_to_ids cannot include self links.');
      }
      const target = db.query('SELECT 1 FROM memories WHERE id = ?').get(targetId);
      if (!target) {
        throw new Error(
          `Cannot patch memory: linked memory id ${targetId} does not exist. Use memory_query or search to find valid IDs.`
        );
      }
    }

    const patchTransaction = db.transaction(() => {
      if (patch.name !== undefined || patch.content !== undefined) {
        const row = requireMemory(id);
        const ts = now();
        const sets: string[] = ['updated_at = ?', 'changed_at = ?'];
        const params: any[] = [ts, ts];

        if (patch.name !== undefined) {
          sets.push('name = ?');
          params.push(patch.name);
        }
        if (patch.content !== undefined) {
          sets.push('content = ?');
          params.push(patch.content);
        }

        params.push(id);
        db.run(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`, params);
        ftsUpdate(id, patch.name ?? row.name, patch.content ?? row.content);
      }

      if (patch.pinned !== undefined) {
        const ts = now();
        db.run('UPDATE memories SET pinned = ?, updated_at = ?, changed_at = ? WHERE id = ?', [
          patch.pinned ? 1 : 0,
          ts,
          ts,
          id,
        ]);
      }

      if (patch.tierTransition === 'promote') {
        promote(id);
      } else if (patch.tierTransition === 'demote') {
        demote(id);
      }

      for (const tag of patch.addTags ?? []) {
        addMemoryTag(id, tag);
      }

      for (const tag of patch.removeTags ?? []) {
        removeMemoryTag(id, tag);
      }

      if ((patch.addLinksToIds?.length ?? 0) > 0) {
        const ts = now();
        const stmt = db.prepare(
          'INSERT OR REPLACE INTO links (source_id, target_id, label, created_at) VALUES (?, ?, ?, ?)'
        );
        for (const targetId of patch.addLinksToIds ?? []) {
          stmt.run(id, targetId, 'related', ts);
        }
      }

      for (const targetId of patch.removeLinksToIds ?? []) {
        db.run('DELETE FROM links WHERE source_id = ? AND target_id = ?', [id, targetId]);
      }
    });

    patchTransaction();

    if (isRagEnabled() && (patch.name !== undefined || patch.content !== undefined)) {
      const memory = rowToMemory(db.query('SELECT * FROM memories WHERE id = ?').get(id) as any);
      const embedding = await getEmbedding(`${memory.name} ${memory.content}`);
      if (embedding) {
        db.run('UPDATE memories SET embedding = ? WHERE id = ?', [vectorToBlob(embedding), id]);
      }
    }

    return rowToMemory(db.query('SELECT * FROM memories WHERE id = ?').get(id) as any);
  }

  // ── Tags ──

  function addMemoryTag(memoryId: number, tag: string): void {
    requireMemory(memoryId);
    const normalized = normalizeTag(tag);
    db.run('INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)', [
      memoryId,
      normalized,
    ]);
    const ts = now();
    db.run('UPDATE memories SET updated_at = ?, changed_at = ? WHERE id = ?', [ts, ts, memoryId]);
  }

  function removeMemoryTag(memoryId: number, tag: string): void {
    requireMemory(memoryId);
    const normalized = normalizeTag(tag);
    db.run('DELETE FROM memory_tags WHERE memory_id = ? AND tag = ?', [memoryId, normalized]);
    const ts = now();
    db.run('UPDATE memories SET updated_at = ?, changed_at = ? WHERE id = ?', [ts, ts, memoryId]);
  }

  function setMemoryTags(memoryId: number, tags: string[]): void {
    requireMemory(memoryId);
    const ts = now();
    const transaction = db.transaction(() => {
      // Clear existing tags
      db.run('DELETE FROM memory_tags WHERE memory_id = ?', [memoryId]);
      // Add new tags
      if (tags.length > 0) {
        const normalizedTags = normalizeTags(tags);
        const stmt = db.prepare('INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)');
        for (const tag of normalizedTags) {
          stmt.run(memoryId, tag);
        }
      }
    });
    transaction();
    db.run('UPDATE memories SET updated_at = ?, changed_at = ? WHERE id = ?', [ts, ts, memoryId]);
  }

  function listAllTags(): {
    spaces: { tag: string; count: number }[];
    memories: { tag: string; count: number }[];
  } {
    const spaceTags = db
      .query('SELECT tag, COUNT(*) as count FROM space_tags GROUP BY tag ORDER BY tag')
      .all() as {
      tag: string;
      count: number;
    }[];
    const memoryTags = db
      .query('SELECT tag, COUNT(*) as count FROM memory_tags GROUP BY tag ORDER BY tag')
      .all() as { tag: string; count: number }[];
    return { spaces: spaceTags, memories: memoryTags };
  }

  // ── Tiers ──

  function promote(id: number): void {
    const row = requireMemory(id);
    if (row.tier <= 1) throw new Error('Memory is already at the highest tier');

    const toTier = row.tier - 1;
    // Throws if full and all are pinned
    ensureCapacity(row.space_name, toTier, true, true);
    const ts = now();
    db.run('UPDATE memories SET tier = ?, updated_at = ?, changed_at = ? WHERE id = ?', [
      toTier,
      ts,
      ts,
      id,
    ]);
  }

  function demote(id: number): void {
    const row = requireMemory(id);
    if (row.tier >= 3) throw new Error('Memory is already at the lowest tier');
    const ts = now();
    db.run('UPDATE memories SET tier = tier + 1, updated_at = ?, changed_at = ? WHERE id = ?', [
      ts,
      ts,
      id,
    ]);
  }

  function pin(id: number): void {
    requireMemory(id);
    const ts = now();
    db.run('UPDATE memories SET pinned = 1, updated_at = ?, changed_at = ? WHERE id = ?', [
      ts,
      ts,
      id,
    ]);
  }

  function unpin(id: number): void {
    requireMemory(id);
    const ts = now();
    db.run('UPDATE memories SET pinned = 0, updated_at = ?, changed_at = ? WHERE id = ?', [
      ts,
      ts,
      id,
    ]);
  }

  // ── Links ──

  function linkMemories(sourceId: number, targetId: number, label?: string): void {
    requireMemory(sourceId);
    requireMemory(targetId);
    if (sourceId === targetId) throw new Error('Cannot link a memory to itself');

    db.run(
      'INSERT OR REPLACE INTO links (source_id, target_id, label, created_at) VALUES (?, ?, ?, ?)',
      [sourceId, targetId, label ?? 'related', now()]
    );
  }

  function unlinkMemories(sourceId: number, targetId: number): void {
    db.run('DELETE FROM links WHERE source_id = ? AND target_id = ?', [sourceId, targetId]);
  }

  function getLinks(memoryId: number): Link[] {
    const rows = db
      .query(
        `SELECT l.*,
                        sm.name as source_name, sm.space_name as source_space,
                        tm.name as target_name, tm.space_name as target_space
                 FROM links l
                 JOIN memories sm ON sm.id = l.source_id
                 JOIN memories tm ON tm.id = l.target_id
                 WHERE l.source_id = ? OR l.target_id = ?
                 ORDER BY l.created_at DESC`
      )
      .all(memoryId, memoryId) as any[];

    return rows.map(r => ({
      source_id: r.source_id,
      target_id: r.target_id,
      source_name: r.source_name,
      source_space: r.source_space,
      target_name: r.target_name,
      target_space: r.target_space,
      label: r.label,
      created_at: r.created_at,
    }));
  }

  // ── Search ──

  async function searchMemories(query: string, filter?: SearchFilter): Promise<SearchResult[]> {
    // Sanitize FTS5 query: support trailing * for prefix match, wrap each term in quotes
    const sanitized = query
      .replace(/'/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map(term => {
        const trailing = term.endsWith('*');
        const clean = term.replace(/\*/g, '');
        if (!clean) return null;
        return trailing ? `"${clean}"*` : `"${clean}"`;
      })
      .filter(Boolean)
      .join(' ');

    if (!sanitized) return [];

    let sql = `
            SELECT m.id, m.space_name, m.name, m.content, m.tier, m.pinned,
                   m.created_at, m.updated_at, m.changed_at, fts.rank
            FROM memories_fts fts
            JOIN memories m ON m.id = fts.rowid
            WHERE memories_fts MATCH ?
        `;
    const params: any[] = [sanitized];

    if (filter?.space) {
      sql += ' AND m.space_name = ?';
      params.push(filter.space);
    }
    if (filter?.tier) {
      sql += ' AND m.tier = ?';
      params.push(filter.tier);
    }

    sql += ' ORDER BY fts.rank';

    let rows = db.query(sql).all(...params) as any[];

    // Post-filter by tag (requires join)
    if (filter?.tag) {
      const normalizedTag = normalizeTag(filter.tag);
      rows = rows.filter(r => {
        const tags = getTagsForMemory(r.id);
        return tags.includes(normalizedTag);
      });
    }

    // If RAG is enabled, enrich and re-rank results with semantic similarity.
    // If FTS returned nothing, fall back to pure semantic search across all candidates.
    if (isRagEnabled()) {
      const normalizeScores = (values: number[]): number[] => {
        if (values.length === 0) return [];
        const min = Math.min(...values);
        const max = Math.max(...values);
        if (min === max) return values.map(() => 1);
        return values.map(value => (value - min) / (max - min));
      };

      const getEmbeddingForId = (id: number): Float32Array | null => {
        const row = db.query('SELECT embedding FROM memories WHERE id = ?').get(id) as any;
        return row?.embedding ? blobToVector(row.embedding) : null;
      };

      // FTS returned results — re-rank by semantic similarity
      if (rows.length > 0) {
        const HYBRID_FTS_WEIGHT = 0.65;
        const HYBRID_SEMANTIC_WEIGHT = 0.35;
        const allIds = rows.map(r => r.id);
        const semanticResults = await semanticSearch(query, getEmbeddingForId, allIds);
        const semanticMap = new Map(semanticResults.map(sr => [sr.id, sr.score]));
        const rankMap = new Map(rows.map(row => [row.id, Number(row.rank) || 0]));

        const normalizedFts = normalizeScores(rows.map(row => -(Number(row.rank) || 0)));
        const normalizedSemantic = normalizeScores(rows.map(row => semanticMap.get(row.id) ?? 0));
        const hybridScore = new Map<number, number>();

        for (let index = 0; index < rows.length; index++) {
          const row = rows[index]!;
          const score =
            (normalizedFts[index] ?? 0) * HYBRID_FTS_WEIGHT +
            (normalizedSemantic[index] ?? 0) * HYBRID_SEMANTIC_WEIGHT;
          hybridScore.set(row.id, score);
        }

        // Re-rank by hybrid score (highest first), deterministic tie-breakers.
        rows.sort((a, b) => {
          const byHybrid = (hybridScore.get(b.id) ?? 0) - (hybridScore.get(a.id) ?? 0);
          if (byHybrid !== 0) return byHybrid;
          const byRank = (rankMap.get(a.id) ?? 0) - (rankMap.get(b.id) ?? 0);
          if (byRank !== 0) return byRank;
          return a.id - b.id;
        });

        return rows.map(r => ({
          id: r.id,
          space_name: r.space_name,
          name: r.name,
          content: r.content,
          tier: r.tier as Tier,
          pinned: r.pinned === 1,
          tags: getTagsForMemory(r.id),
          rank: r.rank,
          similarity: semanticMap.get(r.id) ?? undefined,
          created_at: r.created_at,
          updated_at: r.updated_at,
          changed_at: r.changed_at,
        }));
      }

      // FTS returned nothing — fall back to pure semantic search across all candidates
      const SEMANTIC_FALLBACK_THRESHOLD = 0.3;
      let candSql =
        'SELECT id, space_name, name, content, tier, pinned, created_at, updated_at, changed_at FROM memories WHERE 1=1';
      const candParams: any[] = [];
      if (filter?.space) {
        candSql += ' AND space_name = ?';
        candParams.push(filter.space);
      }
      if (filter?.tier) {
        candSql += ' AND tier = ?';
        candParams.push(filter.tier);
      }
      let candidates = db.query(candSql).all(...candParams) as any[];
      if (filter?.tag) {
        const normalizedTag = normalizeTag(filter.tag);
        candidates = candidates.filter(r => getTagsForMemory(r.id).includes(normalizedTag));
      }

      const allIds = candidates.map((r: any) => r.id);
      const semanticResults = await semanticSearch(query, getEmbeddingForId, allIds);
      const goodResults = semanticResults.filter(sr => sr.score >= SEMANTIC_FALLBACK_THRESHOLD);
      if (goodResults.length === 0) return [];

      const idToMem = new Map(candidates.map((r: any) => [r.id, r]));
      return goodResults.map(sr => {
        const r = idToMem.get(sr.id)!;
        return {
          id: r.id,
          space_name: r.space_name,
          name: r.name,
          content: r.content,
          tier: r.tier as Tier,
          pinned: r.pinned === 1,
          tags: getTagsForMemory(r.id),
          rank: 0,
          similarity: sr.score,
          created_at: r.created_at,
          updated_at: r.updated_at,
          changed_at: r.changed_at,
        };
      });
    }

    return rows.map(r => ({
      id: r.id,
      space_name: r.space_name,
      name: r.name,
      content: r.content,
      tier: r.tier as Tier,
      pinned: r.pinned === 1,
      tags: getTagsForMemory(r.id),
      rank: r.rank,
      similarity: undefined, // Only populated when RAG is enabled
      created_at: r.created_at,
      updated_at: r.updated_at,
      changed_at: r.changed_at,
    }));
  }

  // ── Search with fallback chain: FTS5 → LIKE → embeddings ──
  async function searchFallback(
    query: string,
    filter?: SearchFilter
  ): Promise<{ results: SearchResult[]; search_method: string }> {
    // Step 1: Try FTS5
    let ftsResults = await searchFts5(query, filter);
    if (ftsResults.length > 0) {
      return { results: ftsResults, search_method: 'fts5' };
    }

    // Step 2: FTS returned nothing — try LIKE fallback
    let likeResults = searchLike(query, filter);
    if (likeResults.length > 0) {
      return { results: likeResults, search_method: 'like' };
    }

    // Step 3: If RAG enabled, try embeddings fallback
    if (isRagEnabled()) {
      const semanticResults = await searchSemantic(query, filter);
      if (semanticResults.length > 0) {
        return { results: semanticResults, search_method: 'embeddings' };
      }
    }

    return { results: [], search_method: 'fts5' };
  }

  async function searchFts5(query: string, filter?: SearchFilter): Promise<SearchResult[]> {
    // Sanitize FTS5 query: support trailing * for prefix match, wrap each term in quotes
    const sanitized = query
      .replace(/'/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map(term => {
        const trailing = term.endsWith('*');
        const clean = term.replace(/\*/g, '');
        if (!clean) return null;
        return trailing ? `"${clean}"*` : `"${clean}"`;
      })
      .filter(Boolean)
      .join(' ');

    if (!sanitized) return [];

    let sql = `
            SELECT m.id, m.space_name, m.name, m.content, m.tier, m.pinned,
                   m.created_at, m.updated_at, m.changed_at, fts.rank
            FROM memories_fts fts
            JOIN memories m ON m.id = fts.rowid
            WHERE memories_fts MATCH ?
        `;
    const params: any[] = [sanitized];

    if (filter?.space) {
      sql += ' AND m.space_name = ?';
      params.push(filter.space);
    }
    if (filter?.tier) {
      sql += ' AND m.tier = ?';
      params.push(filter.tier);
    }

    sql += ' ORDER BY fts.rank';

    let rows = db.query(sql).all(...params) as any[];

    // Post-filter by tag
    if (filter?.tag) {
      const normalizedTag = normalizeTag(filter.tag);
      rows = rows.filter(r => {
        const tags = getTagsForMemory(r.id);
        return tags.includes(normalizedTag);
      });
    }

    return rows.map(r => ({
      id: r.id,
      space_name: r.space_name,
      name: r.name,
      content: r.content,
      tier: r.tier as Tier,
      pinned: r.pinned === 1,
      tags: getTagsForMemory(r.id),
      rank: r.rank,
      similarity: undefined,
      created_at: r.created_at,
      updated_at: r.updated_at,
      changed_at: r.changed_at,
    }));
  }

  function searchLike(query: string, filter?: SearchFilter): SearchResult[] {
    // Simple LIKE-based search as fallback when FTS5 returns nothing
    const likePattern = `%${query}%`;

    let sql = `
            SELECT m.id, m.space_name, m.name, m.content, m.tier, m.pinned,
                   m.created_at, m.updated_at, m.changed_at
            FROM memories m
            WHERE (m.name LIKE ? OR m.content LIKE ?)
        `;
    const params: any[] = [likePattern, likePattern];

    if (filter?.space) {
      sql += ' AND m.space_name = ?';
      params.push(filter.space);
    }
    if (filter?.tier) {
      sql += ' AND m.tier = ?';
      params.push(filter.tier);
    }

    sql += ' ORDER BY m.changed_at DESC, m.id DESC';

    let rows = db.query(sql).all(...params) as any[];

    // Post-filter by tag
    if (filter?.tag) {
      const normalizedTag = normalizeTag(filter.tag);
      rows = rows.filter(r => {
        const tags = getTagsForMemory(r.id);
        return tags.includes(normalizedTag);
      });
    }

    return rows.map(r => ({
      id: r.id,
      space_name: r.space_name,
      name: r.name,
      content: r.content,
      tier: r.tier as Tier,
      pinned: r.pinned === 1,
      tags: getTagsForMemory(r.id),
      rank: 0,
      similarity: undefined,
      created_at: r.created_at,
      updated_at: r.updated_at,
      changed_at: r.changed_at,
    }));
  }

  async function searchSemantic(query: string, filter?: SearchFilter): Promise<SearchResult[]> {
    if (!isRagEnabled()) return [];

    const SEMANTIC_FALLBACK_THRESHOLD = 0.3;

    let candSql =
      'SELECT id, space_name, name, content, tier, pinned, created_at, updated_at, changed_at FROM memories WHERE 1=1';
    const candParams: any[] = [];
    if (filter?.space) {
      candSql += ' AND space_name = ?';
      candParams.push(filter.space);
    }
    if (filter?.tier) {
      candSql += ' AND tier = ?';
      candParams.push(filter.tier);
    }
    let candidates = db.query(candSql).all(...candParams) as any[];
    if (filter?.tag) {
      const normalizedTag = normalizeTag(filter.tag);
      candidates = candidates.filter(r => getTagsForMemory(r.id).includes(normalizedTag));
    }

    const getEmbeddingForId = (id: number): Float32Array | null => {
      const row = db.query('SELECT embedding FROM memories WHERE id = ?').get(id) as any;
      return row?.embedding ? blobToVector(row.embedding) : null;
    };

    const allIds = candidates.map((r: any) => r.id);
    const semanticResults = await semanticSearch(query, getEmbeddingForId, allIds);
    const goodResults = semanticResults.filter(sr => sr.score >= SEMANTIC_FALLBACK_THRESHOLD);
    if (goodResults.length === 0) return [];

    const idToMem = new Map(candidates.map((r: any) => [r.id, r]));
    return goodResults.map(sr => {
      const r = idToMem.get(sr.id)!;
      return {
        id: r.id,
        space_name: r.space_name,
        name: r.name,
        content: r.content,
        tier: r.tier as Tier,
        pinned: r.pinned === 1,
        tags: getTagsForMemory(r.id),
        rank: 0,
        similarity: sr.score,
        created_at: r.created_at,
        updated_at: r.updated_at,
        changed_at: r.changed_at,
      };
    });
  }

  function queryMemories(filter?: MemoryQueryFilter): MemorySummary[] {
    let sql =
      'SELECT m.id, m.space_name, m.name, m.tier, m.pinned, m.access_count, m.created_at, m.updated_at, m.changed_at FROM memories m';
    const joinParams: any[] = [];
    const conditions: string[] = [];
    const whereParams: any[] = [];

    if (filter?.tag) {
      sql += ' JOIN memory_tags mt ON mt.memory_id = m.id AND mt.tag = ?';
      joinParams.push(normalizeTag(filter.tag));
    }

    if (filter?.space) {
      conditions.push('m.space_name = ?');
      whereParams.push(filter.space);
    }

    if (filter?.tier !== undefined) {
      conditions.push('m.tier = ?');
      whereParams.push(filter.tier);
    }

    if (filter?.from) {
      conditions.push('m.changed_at >= ?');
      whereParams.push(normalizeDateBound(filter.from, false));
    }

    if (filter?.to) {
      conditions.push('m.changed_at <= ?');
      whereParams.push(normalizeDateBound(filter.to, true));
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const limit = Math.max(1, Math.min(500, filter?.limit ?? 25));
    const offset = Math.max(0, filter?.offset ?? 0);

    sql += ' ORDER BY m.changed_at DESC, m.id DESC LIMIT ? OFFSET ?';
    const rows = db.query(sql).all(...joinParams, ...whereParams, limit, offset) as any[];

    return rows.map(r => ({
      id: r.id,
      space_name: r.space_name,
      name: r.name,
      tier: r.tier as Tier,
      pinned: r.pinned === 1,
      tags: getTagsForMemory(r.id),
      access_count: r.access_count,
      created_at: r.created_at,
      updated_at: r.updated_at,
      changed_at: r.changed_at,
    }));
  }

  async function queryMemoriesCount(filter: {
    space?: string;
    tag?: string;
    tier?: number;
    from?: string;
    to?: string;
  }): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM memories m';
    const joinParams: any[] = [];
    const conditions: string[] = [];
    const whereParams: any[] = [];

    if (filter?.tag) {
      sql += ' JOIN memory_tags mt ON mt.memory_id = m.id AND mt.tag = ?';
      joinParams.push(normalizeTag(filter.tag));
    }

    if (filter?.space) {
      conditions.push('m.space_name = ?');
      whereParams.push(filter.space);
    }

    if (filter?.tier !== undefined) {
      conditions.push('m.tier = ?');
      whereParams.push(filter.tier);
    }

    if (filter?.from) {
      conditions.push('m.changed_at >= ?');
      whereParams.push(normalizeDateBound(filter.from, false));
    }

    if (filter?.to) {
      conditions.push('m.changed_at <= ?');
      whereParams.push(normalizeDateBound(filter.to, true));
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const row = db.query(sql).get(...joinParams, ...whereParams) as { count: number };
    return row.count;
  }

  function getSpaceGraph(
    space: string,
    opts?: { limit?: number; maxLimit?: number }
  ): SpaceGraphResult {
    requireSpace(space);

    const requestedLimit = opts?.limit ?? 300;
    const maxLimit = opts?.maxLimit ?? 1000;
    const normalizedRequestedLimit = Math.max(1, Math.trunc(requestedLimit));
    const appliedLimit = Math.min(normalizedRequestedLimit, Math.max(1, Math.trunc(maxLimit)));

    const totalRow = db
      .query('SELECT COUNT(*) as total FROM memories WHERE space_name = ? AND tier < 4')
      .get(space) as {
      total: number;
    };
    const totalNodes = totalRow.total;

    const rows = db
      .query(
        `SELECT id, name, tier
                 FROM memories
                 WHERE space_name = ? AND tier < 4
                 ORDER BY tier ASC, access_count DESC, name ASC
                 LIMIT ?`
      )
      .all(space, appliedLimit) as { id: number; name: string; tier: Tier }[];

    const nodeMap = new Map<
      number,
      { id: number; name: string; tier: Tier; links_to: number[]; linked_by: number[] }
    >(
      rows.map(row => [
        row.id,
        { id: row.id, name: row.name, tier: row.tier, links_to: [], linked_by: [] },
      ])
    );

    if (rows.length > 0) {
      const selectedIds = rows.map(row => row.id);
      const placeholders = selectedIds.map(() => '?').join(',');
      const params = [space, space, ...selectedIds, ...selectedIds];

      const linkRows = db
        .query(
          `SELECT l.source_id, l.target_id
                     FROM links l
                     JOIN memories sm ON sm.id = l.source_id
                     JOIN memories tm ON tm.id = l.target_id
                     WHERE sm.space_name = ?
                       AND tm.space_name = ?
                       AND (l.source_id IN (${placeholders}) OR l.target_id IN (${placeholders}))`
        )
        .all(...params) as { source_id: number; target_id: number }[];

      for (const linkRow of linkRows) {
        const sourceNode = nodeMap.get(linkRow.source_id);
        if (sourceNode) sourceNode.links_to.push(linkRow.target_id);

        const targetNode = nodeMap.get(linkRow.target_id);
        if (targetNode) targetNode.linked_by.push(linkRow.source_id);
      }

      for (const node of nodeMap.values()) {
        node.links_to.sort((a, b) => a - b);
        node.linked_by.sort((a, b) => a - b);
      }
    }

    const nodes = rows.map(row => nodeMap.get(row.id)!);

    return {
      nodes,
      meta: {
        total_nodes: totalNodes,
        returned_nodes: nodes.length,
        requested_limit: normalizedRequestedLimit,
        applied_limit: appliedLimit,
        max_limit: Math.max(1, Math.trunc(maxLimit)),
        truncated: nodes.length < totalNodes,
      },
    };
  }

  // ── Status ──

  function getStatus(space?: string): StatusResult {
    const spaceFilter = space ? 'WHERE space_name = ?' : '';
    const spaceParams: any[] = space ? [space] : [];

    const total_spaces = space
      ? 1
      : (db.query('SELECT COUNT(*) as c FROM spaces').get() as { c: number }).c;

    const total_memories = (
      db.query(`SELECT COUNT(*) as c FROM memories ${spaceFilter}`).get(...spaceParams) as {
        c: number;
      }
    ).c;

    const tierRows = db
      .query(
        `SELECT tier, COUNT(*) as count, SUM(pinned) as pinned
                 FROM memories ${spaceFilter}
                 GROUP BY tier
                 ORDER BY tier`
      )
      .all(...spaceParams) as { tier: number; count: number; pinned: number }[];

    // Always return all 3 tiers
    const allTiers: Tier[] = [1, 2, 3];
    const by_tier = allTiers.map(t => {
      const row = tierRows.find(r => r.tier === t);
      return { tier: t, count: row?.count ?? 0, pinned: row?.pinned ?? 0 };
    });

    let db_size_bytes = 0;
    try {
      db_size_bytes = statSync(dbPath).size;
    } catch {
      db_size_bytes = 0;
    }

    // Count memories with embeddings
    let embedSql = 'SELECT COUNT(*) as c FROM memories WHERE embedding IS NOT NULL';
    const embedParams: any[] = [];
    if (space) {
      embedSql += ' AND space_name = ?';
      embedParams.push(space);
    }
    const embeddings_indexed = (db.query(embedSql).get(...embedParams) as { c: number }).c;

    return {
      db_path: dbPath,
      db_size_bytes,
      total_spaces,
      total_memories,
      by_tier,
      rag_enabled: isRagEnabled(),
      embeddings_indexed,
    };
  }

  // ── Migration ──

  function importFromJson(brain: LegacyBrain): void {
    const transaction = db.transaction(() => {
      for (const [spaceName, spaceData] of Object.entries(brain)) {
        const existing = db.query('SELECT 1 FROM spaces WHERE name = ?').get(spaceName);
        if (!existing) {
          const ts = now();
          db.run(
            'INSERT INTO spaces (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)',
            [spaceName, spaceData.description, ts, ts]
          );
        }

        for (const memory of spaceData.memories) {
          const memName = memory.name || '(unnamed)';
          const existingMem = db
            .query('SELECT 1 FROM memories WHERE space_name = ? AND name = ?')
            .get(spaceName, memName);
          if (!existingMem) {
            const ts = now();
            const result = db.run(
              `INSERT INTO memories (space_name, name, content, tier, created_at, updated_at, changed_at)
                             VALUES (?, ?, ?, 2, ?, ?, ?)`,
              [spaceName, memName, memory.description ?? '', ts, ts, ts]
            );
            ftsInsert(Number(result.lastInsertRowid), memName, memory.description ?? '');
          }
        }
      }
    });

    transaction();
  }

  // ── Logs ──

  const MAX_LOG_FIELD_SIZE = 65536; // 64KB truncation limit

  function truncateLogField(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    return str.length > MAX_LOG_FIELD_SIZE ? str.slice(0, MAX_LOG_FIELD_SIZE) : str;
  }

  let lastLogId = 0;

  function addLog(entry: {
    source: 'cli' | 'mcp' | 'api';
    operation: string;
    level?: 'info' | 'warn' | 'error';
    inputData?: Record<string, unknown>;
    outputData?: Record<string, unknown>;
    errorMessage?: string;
    callerInfo?: Record<string, unknown>;
    durationMs?: number;
  }): void {
    try {
      // Fire-and-forget: don't await, don't block
      db.run(
        `INSERT INTO logs (source, operation, level, input_data, output_data, error_message, caller_info, duration_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.source,
          entry.operation,
          entry.level ?? 'info',
          truncateLogField(entry.inputData),
          truncateLogField(entry.outputData),
          truncateLogField(entry.errorMessage),
          truncateLogField(entry.callerInfo),
          entry.durationMs ?? null,
        ]
      );

      // Get the last inserted ID
      const lastRow = db.query('SELECT last_insert_rowid() as id').get() as { id: number };
      lastLogId = lastRow.id;

      // Notify SSE subscribers (non-blocking)
      const logEntry = db.query('SELECT * FROM logs WHERE id = ?').get(lastLogId);
      if (logEntry) {
        notifyLogSubscribers(logEntry);
      }
    } catch {
      // Non-blocking: logging failures must not affect operations
    }
  }

  function queryLogs(filter?: {
    source?: string;
    operation?: string;
    search?: string;
    from?: string;
    to?: string;
    level?: 'info' | 'warn' | 'error';
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
    since?: number;
  }): { logs: any[]; total: number; limit: number; offset: number } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.source) {
      const sources = filter.source.split(',').map(s => s.trim().toLowerCase());
      conditions.push(`source IN (${sources.map(() => '?').join(',')})`);
      params.push(...sources);
    }

    if (filter?.operation) {
      conditions.push('operation = ?');
      params.push(filter.operation);
    }

    if (filter?.search) {
      const searchTerm = `%${filter.search}%`;
      conditions.push(
        '(operation LIKE ? OR input_data LIKE ? OR output_data LIKE ? OR error_message LIKE ?)'
      );
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (filter?.from) {
      conditions.push('timestamp >= ?');
      params.push(filter.from);
    }

    if (filter?.to) {
      conditions.push('timestamp <= ?');
      params.push(filter.to);
    }

    if (filter?.level) {
      conditions.push('level = ?');
      params.push(filter.level);
    }

    if (filter?.since !== undefined) {
      conditions.push('id > ?');
      params.push(filter.since);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countRow = db
      .query(`SELECT COUNT(*) as total FROM logs ${whereClause}`)
      .get(...params) as {
      total: number;
    };
    const total = countRow.total;

    const limit = Math.max(1, Math.min(500, filter?.limit ?? 100));
    const offset = Math.max(0, filter?.offset ?? 0);
    const order = filter?.order === 'asc' ? 'ASC' : 'DESC';

    const rows = db
      .query(`SELECT * FROM logs ${whereClause} ORDER BY timestamp ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as any[];

    return {
      logs: rows.map(r => ({
        id: r.id,
        source: r.source,
        operation: r.operation,
        level: r.level,
        input_data: r.input_data,
        output_data: r.output_data,
        error_message: r.error_message,
        caller_info: r.caller_info,
        duration_ms: r.duration_ms,
        timestamp: r.timestamp,
      })),
      total,
      limit,
      offset,
    };
  }

  function cleanupOldLogs(retentionMinutes: number): number {
    const cutoff = new Date(Date.now() - retentionMinutes * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .split('.')[0]!;
    const result = db.run('DELETE FROM logs WHERE timestamp < ?', [cutoff]);
    return result.changes;
  }

  function clearAllLogs(): number {
    const result = db.run('DELETE FROM logs');
    return result.changes;
  }

  // ── Lifecycle ──

  function close(): void {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // Best-effort WAL checkpoint before close
    }
    db.close();
  }

  return {
    createSpace,
    getSpace,
    listSpaces,
    updateSpace,
    deleteSpace,
    renameSpace,
    addSpaceTag,
    removeSpaceTag,
    addMemory,
    getMemory,
    getMemoryById,
    listMemories,
    getHotMemories,
    resolveMemoryRef,
    updateMemory,
    deleteMemory,
    deleteMemoryByName,
    recordAccess,
    getLinkedMemorySummaries,
    patchMemory,
    addMemoryTag,
    removeMemoryTag,
    setMemoryTags,
    listAllTags,
    promote,
    demote,
    pin,
    unpin,
    link: linkMemories,
    unlink: unlinkMemories,
    getLinks,
    search: searchMemories,
    searchFallback,
    queryMemories,
    queryMemoriesCount,
    getSpaceGraph,
    getStatus,
    importFromJson,
    addLog,
    queryLogs,
    cleanupOldLogs,
    clearAllLogs,
    subscribeToLogs,
    unsubscribeFromLogs,
    close,
  };
}

// ── SSE Pub/Sub for real-time logs ──
type SseController = {
  enqueue: (_data: string) => void;
  close: () => void;
};

const logSubscribers = new Map<string, { controller: SseController; filter?: string }>();

export function subscribeToLogs(
  sessionId: string,
  controller: SseController,
  filter?: string
): void {
  logSubscribers.set(sessionId, { controller, filter });
}

export function unsubscribeFromLogs(sessionId: string): void {
  const sub = logSubscribers.get(sessionId);
  if (sub) {
    sub.controller.close();
    logSubscribers.delete(sessionId);
  }
}

function notifyLogSubscribers(logEntry: any): void {
  for (const [sessionId, sub] of logSubscribers) {
    try {
      // Apply filter if set (supports comma-separated multiple sources)
      if (sub.filter) {
        const filters = sub.filter.split(',').map(s => s.trim().toLowerCase());
        if (!filters.includes(logEntry.source.toLowerCase())) {
          continue;
        }
      }
      const data = `data: ${JSON.stringify(logEntry)}\n\n`;
      // Pass the string, not bytes - let the subscriber handle encoding
      sub.controller.enqueue(data);
    } catch {
      // Client disconnected, remove
      logSubscribers.delete(sessionId);
    }
  }
}
