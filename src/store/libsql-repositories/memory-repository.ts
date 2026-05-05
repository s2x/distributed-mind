// ── LibSQL MemoryRepository: handles all memory operations ──
// Schema v8 adds: persistence TEXT ('soft'|'hard'), created_by TEXT, client_id TEXT
// memory_versions table tracks audit trail for hard writes.

import type { Client } from '@libsql/client';

import { TIER_LIMITS } from '../../config';
import { blobToVector, getEmbedding, isRagEnabled, vectorToBlob } from '../../helpers/rag';
import { normalizeTags } from '../../helpers/tags';
import type { HotMemorySummary, LegacyBrain, Memory, MemorySummary, Tier } from '../../types';
import type { LinkedMemorySummary, MemoryPatchInput } from '../mind-store';
import { now } from '../shared/datetime-helpers';

import type { TagRepository } from './tag-repository';

// ── Types ──

export interface MemoryRow {
  id: number;
  space_name: string;
  name: string;
  content: string;
  tier: number;
  pinned: number;
  access_count: number;
  last_accessed_at: string | null;
  embedding: Uint8Array | ArrayBuffer | null;
  created_at: string;
  updated_at: string;
  changed_at: string;
  // Schema v8 extra columns
  persistence: string;
  created_by: string | null;
  client_id: string | null;
}

export interface MemoryRepository {
  addMemory(
    space: string,
    name: string,
    content: string,
    opts?: {
      tags?: string[];
      tier?: Tier;
      pinned?: boolean;
      linksToIds?: number[];
      persistence?: 'soft' | 'hard';
    }
  ): Promise<Memory>;
  getMemory(space: string, name: string): Promise<Memory | null>;
  getMemoryById(id: number): Promise<Memory | null>;
  listMemories(space: string, filter?: { tier?: Tier; tag?: string }): Promise<MemorySummary[]>;
  getHotMemories(space: string): Promise<HotMemorySummary[]>;
  resolveMemoryRef(ref: string): Promise<{ space: string; name: string } | null>;
  updateMemory(id: number, updates: { name?: string; content?: string }): Promise<void>;
  deleteMemory(id: number): Promise<void>;
  deleteMemoryByName(space: string, name: string): Promise<void>;
  recordAccess(id: number): Promise<void>;
  getLinkedMemorySummaries(memoryId: number): Promise<{
    links_to: LinkedMemorySummary[];
    linked_by: LinkedMemorySummary[];
  }>;
  patchMemory(id: number, patch: MemoryPatchInput): Promise<Memory>;
  promote(id: number): Promise<void>;
  demote(id: number): Promise<void>;
  pin(id: number): Promise<void>;
  unpin(id: number): Promise<void>;
  promoteToHard(spaceName: string, memoryName: string): Promise<void>;
  demoteToSoft(spaceName: string, memoryName: string): Promise<void>;
  getMemoryHistory(spaceName: string, memoryName: string): Promise<import('../../types').MemoryVersion[]>;
  importFromJson(brain: LegacyBrain): Promise<void>;
}

// ── Helpers ──

function rowToMemory(row: MemoryRow, tags: string[]): Memory {
  return {
    id: row.id,
    space_name: row.space_name,
    name: row.name,
    content: row.content,
    tier: row.tier as Tier,
    pinned: row.pinned !== 0,
    access_count: row.access_count,
    last_accessed_at: row.last_accessed_at,
    // libSQL returns ArrayBuffer for BLOB columns (not Uint8Array like bun:sqlite).
    // blobToVector handles both types.
    embedding: row.embedding ? blobToVector(row.embedding as unknown as ArrayBuffer) : null,
    tags,
    created_at: row.created_at,
    updated_at: row.updated_at,
    changed_at: row.changed_at,
    // TODO: Memory type does not yet have persistence/created_by/client_id fields (schema v8 only).
    // They are carried through row but not exposed on the Memory interface.
  };
}

// ── Factory ──

export function createLibsqlMemoryRepository(
  client: Client,
  tagRepo: TagRepository,
  clientId?: string
): MemoryRepository {
  // ── Internal helpers ──

  async function getTagsForMemory(memoryId: number): Promise<string[]> {
    const result = await client.execute({
      sql: 'SELECT tag FROM memory_tags WHERE memory_id = ?',
      args: [memoryId],
    });
    return result.rows.map((r: any) => r.tag as string);
  }

  async function requireMemory(id: number): Promise<MemoryRow> {
    const result = await client.execute({
      sql: 'SELECT * FROM memories WHERE id = ?',
      args: [id],
    });
    if (result.rows.length === 0) {
      throw new Error(
        `Memory with id ${id} does not exist. Use memory_query or search to find valid IDs.`
      );
    }
    return result.rows[0] as unknown as MemoryRow;
  }

  async function fetchMemoryRow(id: number): Promise<MemoryRow | null> {
    const result = await client.execute({
      sql: 'SELECT * FROM memories WHERE id = ?',
      args: [id],
    });
    if (result.rows.length === 0) return null;
    return result.rows[0] as unknown as MemoryRow;
  }

  // ── FTS helpers ──

  async function ftsInsert(id: number, name: string, content: string): Promise<void> {
    await client.execute({
      sql: 'INSERT INTO memories_fts(rowid, name, content) VALUES (?, ?, ?)',
      args: [id, name, content],
    });
  }

  async function ftsDelete(id: number): Promise<void> {
    await client.execute({
      sql: 'DELETE FROM memories_fts WHERE rowid = ?',
      args: [id],
    });
  }

  async function ftsUpdate(id: number, name: string, content: string): Promise<void> {
    await client.batch(
      [
        { sql: 'DELETE FROM memories_fts WHERE rowid = ?', args: [id] },
        {
          sql: 'INSERT INTO memories_fts(rowid, name, content) VALUES (?, ?, ?)',
          args: [id, name, content],
        },
      ],
      'write'
    );
  }

  // ── LRU / Capacity helpers ──

  /**
   * Count soft memories (not hard, pinned or not) at a given tier in a space.
   * Hard memories are not counted toward tier limits per the persistence model.
   */
  async function countSoftTierTotal(space: string, tier: number): Promise<number> {
    const result = await client.execute({
      sql: "SELECT COUNT(*) as c FROM memories WHERE space_name = ? AND tier = ? AND persistence = 'soft'",
      args: [space, tier],
    });
    return Number((result.rows[0] as any).c) || 0;
  }

  /**
   * Ensure a tier has capacity for one more soft memory.
   * Hard memories are excluded from both the capacity count and eviction candidates.
   * If the tier is full (soft count >= limit), evicts the LRU non-pinned soft memory to the next tier.
   * T3 is unlimited — always returns true.
   * @param throwOnFull - if true, throws when tier is full and all soft are pinned; if false, returns false
   * @returns true if there is (or was made) capacity, false if no evictable memory
   */
  async function ensureCapacity(
    space: string,
    tier: number,
    throwOnFull: boolean,
    touchChangedAt = true
  ): Promise<boolean> {
    const limit = TIER_LIMITS[tier as 1 | 2];
    if (limit === undefined) return true; // T3: unlimited

    const softTotal = await countSoftTierTotal(space, tier);
    if (softTotal < limit) return true; // room available

    // Tier is full — find LRU non-pinned soft memory to evict
    const lruResult = await client.execute({
      sql: `SELECT id FROM memories
            WHERE space_name = ? AND tier = ? AND pinned = 0 AND persistence = 'soft'
            ORDER BY COALESCE(last_accessed_at, created_at) ASC
            LIMIT 1`,
      args: [space, tier],
    });

    if (lruResult.rows.length === 0) {
      if (throwOnFull) {
        throw new Error(
          `T${tier} is full (${limit}/space) and all memories are pinned. Unpin one to make room.`
        );
      }
      return false;
    }

    const lruId = Number((lruResult.rows[0] as any).id);
    const nextTier = tier + 1;
    const ts = now();

    if (touchChangedAt) {
      await client.execute({
        sql: 'UPDATE memories SET tier = ?, updated_at = ?, changed_at = ? WHERE id = ?',
        args: [nextTier, ts, ts, lruId],
      });
    } else {
      await client.execute({
        sql: 'UPDATE memories SET tier = ?, updated_at = ? WHERE id = ?',
        args: [nextTier, ts, lruId],
      });
    }

    return true;
  }

  // ── Versioning helper (for hard persistence) ──

  async function snapshotToVersions(
    row: MemoryRow,
    operation: 'update' | 'delete'
  ): Promise<void> {
    if (row.persistence !== 'hard') return; // soft memories skip versioning

    // Get next version number
    const versionResult = await client.execute({
      sql: 'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM memory_versions WHERE memory_id = ?',
      args: [row.id],
    });
    const nextVersion = Number((versionResult.rows[0] as any).next_version) || 1;

    // Fetch current tags as JSON string
    const tags = await getTagsForMemory(row.id);
    const ts = now();

    await client.execute({
      sql: `INSERT INTO memory_versions
            (memory_id, space_name, name, content, tags, tier, persistence, version_number, operation, changed_by, client_id, changed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        row.id,
        row.space_name,
        row.name,
        row.content,
        JSON.stringify(tags),
        row.tier,
        row.persistence,
        nextVersion,
        operation,
        row.created_by ?? null,
        row.client_id ?? clientId ?? null,
        ts,
      ],
    });
  }

  // ── Memory operations ──

  async function addMemory(
    space: string,
    name: string,
    content: string,
    opts?: {
      tags?: string[];
      tier?: Tier;
      pinned?: boolean;
      linksToIds?: number[];
      persistence?: 'soft' | 'hard';
    }
  ): Promise<Memory> {
    // Validate space exists
    const spaceResult = await client.execute({
      sql: 'SELECT 1 FROM spaces WHERE name = ?',
      args: [space],
    });
    if (spaceResult.rows.length === 0) {
      throw new Error(`Space "${space}" does not exist. Create it first with space_create tool.`);
    }

    if (!opts?.tags || opts.tags.length === 0) {
      throw new Error('Tags are required and cannot be empty');
    }

    const existing = await client.execute({
      sql: 'SELECT 1 FROM memories WHERE space_name = ? AND name = ?',
      args: [space, name],
    });
    if (existing.rows.length > 0) {
      throw new Error(`Memory "${name}" already exists in space "${space}"`);
    }

    const tier = opts?.tier ?? 2;
    const pinned = opts?.pinned ?? false;
    const linksToIds = opts?.linksToIds ?? [];
    const persistence = opts?.persistence ?? 'soft';

    // Validate linked memories exist
    for (const targetId of linksToIds) {
      const target = await client.execute({
        sql: 'SELECT 1 FROM memories WHERE id = ?',
        args: [targetId],
      });
      if (target.rows.length === 0) {
        throw new Error(
          `Cannot add memory: linked memory id ${targetId} does not exist. Use memory_query or search to find valid IDs.`
        );
      }
    }

    // Ensure capacity (may evict LRU)
    await ensureCapacity(space, tier, true);

    const ts = now();
    const resolvedClientId = clientId ?? process.env.DIMIND_CLIENT_ID ?? null;
    const createdBy = process.env.USER ?? null;

    // Insert memory and get the ID via RETURNING
    const insertResult = await client.execute({
      sql: `INSERT INTO memories
            (space_name, name, content, tier, pinned, created_at, updated_at, changed_at, persistence, created_by, client_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id`,
      args: [
        space,
        name,
        content,
        tier,
        pinned ? 1 : 0,
        ts,
        ts,
        ts,
        persistence,
        createdBy,
        resolvedClientId,
      ],
    });

    const id = Number((insertResult.rows[0] as any).id);

    // Build batch statements for FTS + tags + links
    const batchStatements: Array<{ sql: string; args: unknown[] }> = [];

    // FTS insert
    batchStatements.push({
      sql: 'INSERT INTO memories_fts(rowid, name, content) VALUES (?, ?, ?)',
      args: [id, name, content],
    });

    // Tags
    const normalizedTags = normalizeTags(opts.tags);
    for (const tag of normalizedTags) {
      batchStatements.push({
        sql: 'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)',
        args: [id, tag],
      });
    }

    // Links
    for (const targetId of linksToIds) {
      if (targetId === id) {
        throw new Error('Cannot add memory: add_links_to_ids cannot include self links.');
      }
      batchStatements.push({
        sql: 'INSERT OR REPLACE INTO links (source_id, target_id, label, created_at) VALUES (?, ?, ?, ?)',
        args: [id, targetId, 'related', ts],
      });
    }

    if (batchStatements.length > 0) {
      await client.batch(batchStatements as any, 'write');
    }

    // Generate embedding if RAG is enabled
    if (isRagEnabled()) {
      const embedding = await getEmbedding(`${name} ${content}`);
      if (embedding) {
        await client.execute({
          sql: 'UPDATE memories SET embedding = ? WHERE id = ?',
          args: [vectorToBlob(embedding), id],
        });
      }
    }

    const row = await fetchMemoryRow(id);
    const tags = await getTagsForMemory(id);
    return rowToMemory(row!, tags);
  }

  async function getMemory(space: string, name: string): Promise<Memory | null> {
    const result = await client.execute({
      sql: 'SELECT * FROM memories WHERE space_name = ? AND name = ?',
      args: [space, name],
    });
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as unknown as MemoryRow;
    const tags = await getTagsForMemory(row.id);
    return rowToMemory(row, tags);
  }

  async function getMemoryById(id: number): Promise<Memory | null> {
    const row = await fetchMemoryRow(id);
    if (!row) return null;
    const tags = await getTagsForMemory(id);
    return rowToMemory(row, tags);
  }

  async function listMemories(
    space: string,
    filter?: { tier?: Tier; tag?: string }
  ): Promise<MemorySummary[]> {
    const spaceResult = await client.execute({
      sql: 'SELECT 1 FROM spaces WHERE name = ?',
      args: [space],
    });
    if (spaceResult.rows.length === 0) {
      throw new Error(`Space "${space}" does not exist. Create it first with space_create tool.`);
    }

    let sql =
      'SELECT m.id, m.space_name, m.name, m.tier, m.pinned, m.access_count, m.created_at, m.updated_at, m.changed_at FROM memories m';
    // args ordering: JOIN params first, then WHERE params
    const joinArgs: unknown[] = [];
    const whereArgs: unknown[] = [space];

    if (filter?.tag) {
      const normalizedFilter = filter.tag.toLowerCase().trim();
      sql += ' JOIN memory_tags mt ON mt.memory_id = m.id AND mt.tag = ?';
      joinArgs.push(normalizedFilter);
    }

    sql += ' WHERE m.space_name = ?';

    if (filter?.tier !== undefined) {
      sql += ' AND m.tier = ?';
      whereArgs.push(filter.tier);
    } else {
      sql += ' AND m.tier IN (1, 2)';
    }

    sql += ' ORDER BY m.tier ASC, m.access_count DESC, m.name ASC';

    const args = [...joinArgs, ...whereArgs];
    const result = await client.execute({ sql, args: args as any[] });
    const summaries: MemorySummary[] = [];

    for (const row of result.rows) {
      const r = row as any;
      const tags = await getTagsForMemory(Number(r.id));
      summaries.push({
        id: Number(r.id),
        space_name: r.space_name,
        name: r.name,
        tier: r.tier as Tier,
        pinned: r.pinned !== 0,
        tags,
        access_count: Number(r.access_count),
        created_at: r.created_at,
        updated_at: r.updated_at,
        changed_at: r.changed_at,
      });
    }

    return summaries;
  }

  async function getHotMemories(space: string): Promise<HotMemorySummary[]> {
    const result = await client.execute({
      sql: `SELECT id, name, tier, pinned, updated_at
            FROM memories
            WHERE space_name = ? AND tier IN (1, 2)
            ORDER BY tier ASC, name ASC`,
      args: [space],
    });

    const summaries: HotMemorySummary[] = [];
    for (const row of result.rows) {
      const r = row as any;
      const tags = await getTagsForMemory(Number(r.id));
      summaries.push({
        id: Number(r.id),
        name: r.name,
        tier: r.tier as Tier,
        tags,
        pinned: r.pinned !== 0,
        updated_at: r.updated_at,
      });
    }

    return summaries;
  }

  async function resolveMemoryRef(
    ref: string
  ): Promise<{ space: string; name: string } | null> {
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
    const row = await requireMemory(id);

    // Snapshot to versions for hard memories before update
    await snapshotToVersions(row, 'update');

    const ts = now();
    const sets: string[] = ['updated_at = ?', 'changed_at = ?'];
    const args: unknown[] = [ts, ts];

    if (updates.name !== undefined) {
      sets.push('name = ?');
      args.push(updates.name);
    }
    if (updates.content !== undefined) {
      sets.push('content = ?');
      args.push(updates.content);
    }

    args.push(id);
    await client.execute({
      sql: `UPDATE memories SET ${sets.join(', ')} WHERE id = ?`,
      args: args as any[],
    });

    // Sync FTS if name or content changed
    if (updates.name !== undefined || updates.content !== undefined) {
      await ftsUpdate(id, updates.name ?? row.name, updates.content ?? row.content);
    }

    // Regenerate embedding if RAG is enabled
    if (isRagEnabled() && (updates.name !== undefined || updates.content !== undefined)) {
      const updatedRow = await fetchMemoryRow(id);
      if (updatedRow) {
        const embedding = await getEmbedding(`${updatedRow.name} ${updatedRow.content}`);
        if (embedding) {
          await client.execute({
            sql: 'UPDATE memories SET embedding = ? WHERE id = ?',
            args: [vectorToBlob(embedding), id],
          });
        }
      }
    }
  }

  async function deleteMemory(id: number): Promise<void> {
    const row = await requireMemory(id);

    // Snapshot to versions for hard memories before delete
    await snapshotToVersions(row, 'delete');

    await client.batch(
      [
        { sql: 'DELETE FROM memories_fts WHERE rowid = ?', args: [id] },
        { sql: 'DELETE FROM memories WHERE id = ?', args: [id] },
      ],
      'write'
    );
  }

  async function deleteMemoryByName(space: string, name: string): Promise<void> {
    const mem = await getMemory(space, name);
    if (!mem) throw new Error(`Memory "${name}" not found in space "${space}"`);

    // Fetch row for potential versioning
    const row = await fetchMemoryRow(mem.id);
    if (row) {
      await snapshotToVersions(row, 'delete');
    }

    await client.batch(
      [
        { sql: 'DELETE FROM memories_fts WHERE rowid = ?', args: [mem.id] },
        { sql: 'DELETE FROM memories WHERE id = ?', args: [mem.id] },
      ],
      'write'
    );
  }

  async function recordAccess(id: number): Promise<void> {
    const row = await requireMemory(id);
    const ts = now();

    // Always bump access count and timestamp
    await client.execute({
      sql: 'UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?, updated_at = ? WHERE id = ?',
      args: [ts, ts, id],
    });

    // Auto-promote one tier up — skip if pinned or already at T1
    if (row.pinned !== 0 || row.tier <= 1) return;

    const toTier = row.tier - 1;
    // Silently skip if destination is full and all are pinned (throwOnFull = false)
    const ok = await ensureCapacity(row.space_name, toTier, false, false);
    if (ok) {
      await client.execute({
        sql: 'UPDATE memories SET tier = ?, updated_at = ? WHERE id = ?',
        args: [toTier, ts, id],
      });
    }
  }

  async function getLinkedMemorySummaries(memoryId: number): Promise<{
    links_to: LinkedMemorySummary[];
    linked_by: LinkedMemorySummary[];
  }> {
    await requireMemory(memoryId); // validates existence

    const linksToResult = await client.execute({
      sql: `SELECT m.id, m.name, m.space_name, m.changed_at, m.tier, m.pinned
            FROM links l
            JOIN memories m ON m.id = l.target_id
            WHERE l.source_id = ?
            ORDER BY m.changed_at DESC, m.id DESC`,
      args: [memoryId],
    });

    const linkedByResult = await client.execute({
      sql: `SELECT m.id, m.name, m.space_name, m.changed_at, m.tier, m.pinned
            FROM links l
            JOIN memories m ON m.id = l.source_id
            WHERE l.target_id = ?
            ORDER BY m.changed_at DESC, m.id DESC`,
      args: [memoryId],
    });

    const toSummary = async (row: any): Promise<LinkedMemorySummary> => ({
      id: Number(row.id),
      name: row.name,
      space_name: row.space_name,
      changed_at: row.changed_at,
      tier: row.tier as Tier,
      tags: await getTagsForMemory(Number(row.id)),
      pinned: row.pinned !== 0,
    });

    return {
      links_to: await Promise.all(linksToResult.rows.map(toSummary)),
      linked_by: await Promise.all(linkedByResult.rows.map(toSummary)),
    };
  }

  async function patchMemory(id: number, patch: MemoryPatchInput): Promise<Memory> {
    await requireMemory(id);

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
      const current = await requireMemory(id);
      if (current.tier <= 1) {
        throw new Error('Cannot promote memory: already at T1.');
      }
    }

    if (patch.tierTransition === 'demote') {
      const current = await requireMemory(id);
      if (current.tier >= 3) {
        throw new Error('Cannot demote memory: already at the lowest tier.');
      }
    }

    for (const targetId of patch.addLinksToIds ?? []) {
      if (targetId === id) {
        throw new Error('Cannot patch memory: add_links_to_ids cannot include self links.');
      }
      const target = await client.execute({
        sql: 'SELECT 1 FROM memories WHERE id = ?',
        args: [targetId],
      });
      if (target.rows.length === 0) {
        throw new Error(
          `Cannot patch memory: linked memory id ${targetId} does not exist. Use memory_query or search to find valid IDs.`
        );
      }
    }

    for (const targetId of patch.removeLinksToIds ?? []) {
      if (targetId === id) {
        throw new Error('Cannot patch memory: remove_links_to_ids cannot include self links.');
      }
      const target = await client.execute({
        sql: 'SELECT 1 FROM memories WHERE id = ?',
        args: [targetId],
      });
      if (target.rows.length === 0) {
        throw new Error(
          `Cannot patch memory: linked memory id ${targetId} does not exist. Use memory_query or search to find valid IDs.`
        );
      }
    }

    // Snapshot for hard memories before any updates
    const currentRow = await requireMemory(id);
    const hasContentChange = patch.name !== undefined || patch.content !== undefined;
    if (hasContentChange) {
      await snapshotToVersions(currentRow, 'update');
    }

    // name/content update
    if (hasContentChange) {
      const ts = now();
      const sets: string[] = ['updated_at = ?', 'changed_at = ?'];
      const args: unknown[] = [ts, ts];

      if (patch.name !== undefined) {
        sets.push('name = ?');
        args.push(patch.name);
      }
      if (patch.content !== undefined) {
        sets.push('content = ?');
        args.push(patch.content);
      }

      args.push(id);
      await client.execute({
        sql: `UPDATE memories SET ${sets.join(', ')} WHERE id = ?`,
        args: args as any[],
      });

      await ftsUpdate(
        id,
        patch.name ?? currentRow.name,
        patch.content ?? currentRow.content
      );
    }

    // pinned update
    if (patch.pinned !== undefined) {
      const ts = now();
      await client.execute({
        sql: 'UPDATE memories SET pinned = ?, updated_at = ?, changed_at = ? WHERE id = ?',
        args: [patch.pinned ? 1 : 0, ts, ts, id],
      });
    }

    // tier transition
    if (patch.tierTransition === 'promote') {
      await promote(id);
    } else if (patch.tierTransition === 'demote') {
      await demote(id);
    }

    // tag operations
    for (const tag of patch.addTags ?? []) {
      await tagRepo.addMemoryTag(id, tag);
    }
    for (const tag of patch.removeTags ?? []) {
      await tagRepo.removeMemoryTag(id, tag);
    }

    // link operations
    if ((patch.addLinksToIds?.length ?? 0) > 0) {
      const ts = now();
      const linkStatements: Array<{ sql: string; args: unknown[] }> = [];
      for (const targetId of patch.addLinksToIds ?? []) {
        linkStatements.push({
          sql: 'INSERT OR REPLACE INTO links (source_id, target_id, label, created_at) VALUES (?, ?, ?, ?)',
          args: [id, targetId, 'related', ts],
        });
      }
      await client.batch(linkStatements as any, 'write');
    }

    if ((patch.removeLinksToIds?.length ?? 0) > 0) {
      const removeStatements: Array<{ sql: string; args: unknown[] }> = [];
      for (const targetId of patch.removeLinksToIds ?? []) {
        removeStatements.push({
          sql: 'DELETE FROM links WHERE source_id = ? AND target_id = ?',
          args: [id, targetId],
        });
      }
      await client.batch(removeStatements as any, 'write');
    }

    // RAG embedding update
    if (isRagEnabled() && hasContentChange) {
      const updatedRow = await fetchMemoryRow(id);
      if (updatedRow) {
        const embedding = await getEmbedding(`${updatedRow.name} ${updatedRow.content}`);
        if (embedding) {
          await client.execute({
            sql: 'UPDATE memories SET embedding = ? WHERE id = ?',
            args: [vectorToBlob(embedding), id],
          });
        }
      }
    }

    const finalRow = await fetchMemoryRow(id);
    const finalTags = await getTagsForMemory(id);
    return rowToMemory(finalRow!, finalTags);
  }

  async function promote(id: number): Promise<void> {
    const row = await requireMemory(id);
    if (row.tier <= 1) throw new Error('Memory is already at the highest tier');

    const toTier = row.tier - 1;
    // Throws if full and all are pinned
    await ensureCapacity(row.space_name, toTier, true, true);

    const ts = now();
    await client.execute({
      sql: 'UPDATE memories SET tier = ?, updated_at = ?, changed_at = ? WHERE id = ?',
      args: [toTier, ts, ts, id],
    });
  }

  async function demote(id: number): Promise<void> {
    const row = await requireMemory(id);
    if (row.tier >= 3) throw new Error('Memory is already at the lowest tier');

    const ts = now();
    await client.execute({
      sql: 'UPDATE memories SET tier = tier + 1, updated_at = ?, changed_at = ? WHERE id = ?',
      args: [ts, ts, id],
    });
  }

  async function pin(id: number): Promise<void> {
    await requireMemory(id);
    const ts = now();
    await client.execute({
      sql: 'UPDATE memories SET pinned = 1, updated_at = ?, changed_at = ? WHERE id = ?',
      args: [ts, ts, id],
    });
  }

  async function unpin(id: number): Promise<void> {
    await requireMemory(id);
    const ts = now();
    await client.execute({
      sql: 'UPDATE memories SET pinned = 0, updated_at = ?, changed_at = ? WHERE id = ?',
      args: [ts, ts, id],
    });
  }

  async function importFromJson(brain: LegacyBrain): Promise<void> {
    for (const [spaceName, spaceData] of Object.entries(brain)) {
      const existingSpace = await client.execute({
        sql: 'SELECT 1 FROM spaces WHERE name = ?',
        args: [spaceName],
      });

      if (existingSpace.rows.length === 0) {
        const ts = now();
        await client.execute({
          sql: 'INSERT INTO spaces (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)',
          args: [spaceName, spaceData.description, ts, ts],
        });
      }

      for (const memory of spaceData.memories) {
        const memName = memory.name || '(unnamed)';
        const existingMem = await client.execute({
          sql: 'SELECT 1 FROM memories WHERE space_name = ? AND name = ?',
          args: [spaceName, memName],
        });

        if (existingMem.rows.length === 0) {
          const ts = now();
          const insertResult = await client.execute({
            sql: `INSERT INTO memories (space_name, name, content, tier, created_at, updated_at, changed_at)
                  VALUES (?, ?, ?, 2, ?, ?, ?)
                  RETURNING id`,
            args: [spaceName, memName, memory.description ?? '', ts, ts, ts],
          });
          const newId = Number((insertResult.rows[0] as any).id);
          await ftsInsert(newId, memName, memory.description ?? '');
        }
      }
    }
  }

  async function promoteToHard(spaceName: string, memoryName: string): Promise<void> {
    const result = await client.execute({
      sql: "SELECT id FROM memories WHERE space_name = ? AND name = ?",
      args: [spaceName, memoryName],
    });
    if (result.rows.length === 0) {
      throw new Error(`Memory "${memoryName}" not found in space "${spaceName}"`);
    }
    const ts = now();
    await client.execute({
      sql: "UPDATE memories SET persistence = 'hard', updated_at = ? WHERE space_name = ? AND name = ?",
      args: [ts, spaceName, memoryName],
    });
  }

  async function demoteToSoft(spaceName: string, memoryName: string): Promise<void> {
    const result = await client.execute({
      sql: "SELECT id FROM memories WHERE space_name = ? AND name = ?",
      args: [spaceName, memoryName],
    });
    if (result.rows.length === 0) {
      throw new Error(`Memory "${memoryName}" not found in space "${spaceName}"`);
    }
    const ts = now();
    await client.execute({
      sql: "UPDATE memories SET persistence = 'soft', updated_at = ? WHERE space_name = ? AND name = ?",
      args: [ts, spaceName, memoryName],
    });
  }

  async function getMemoryHistory(
    spaceName: string,
    memoryName: string
  ): Promise<import('../../types').MemoryVersion[]> {
    const memResult = await client.execute({
      sql: 'SELECT id FROM memories WHERE space_name = ? AND name = ?',
      args: [spaceName, memoryName],
    });
    if (memResult.rows.length === 0) return [];
    const memId = Number((memResult.rows[0] as any).id);
    const result = await client.execute({
      sql: 'SELECT * FROM memory_versions WHERE memory_id = ? ORDER BY version_number DESC',
      args: [memId],
    });
    return result.rows.map((row: any) => ({
      id: Number(row.id),
      memoryId: Number(row.memory_id),
      spaceName: String(row.space_name),
      name: String(row.name),
      content: String(row.content),
      operation: row.operation as 'update' | 'delete' | 'revert' | 'create',
      versionNumber: Number(row.version_number),
      changedBy: row.changed_by ? String(row.changed_by) : undefined,
      clientId: row.client_id ? String(row.client_id) : undefined,
      changedAt: String(row.changed_at),
    }));
  }

  return {
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
    promote,
    demote,
    pin,
    unpin,
    promoteToHard,
    demoteToSoft,
    getMemoryHistory,
    importFromJson,
  };
}
