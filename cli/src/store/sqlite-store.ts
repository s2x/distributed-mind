// ── SQLite implementation of MindStore ──

import { Database } from 'bun:sqlite';
import { statSync } from 'fs';
import { initializeDatabase } from './schema';
import { TIER_LIMITS } from '../config';
import { isRagEnabled, getEmbedding, semanticSearch, blobToVector, vectorToBlob } from '../rag';
import type { MindStore } from './mind-store';
import type {
    Space,
    SpaceSummary,
    Memory,
    MemorySummary,
    Link,
    Tier,
    SearchFilter,
    SearchResult,
    StatusResult,
    LegacyBrain,
} from '../types';

export function createSqliteStore(dbPath: string): MindStore {
    const db = new Database(dbPath, { create: true });
    initializeDatabase(db);

    // ── Helpers ──

    function now(): string {
        return new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
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
        const rows = db.query('SELECT tag FROM memory_tags WHERE memory_id = ?').all(memoryId) as { tag: string }[];
        return rows.map((r) => r.tag);
    }

    function getTagsForSpace(spaceName: string): string[] {
        const rows = db.query('SELECT tag FROM space_tags WHERE space_name = ?').all(spaceName) as { tag: string }[];
        return rows.map((r) => r.tag);
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
        };
    }

    function requireSpace(name: string): void {
        const row = db.query('SELECT 1 FROM spaces WHERE name = ?').get(name);
        if (!row) throw new Error(`Space "${name}" does not exist`);
    }

    function requireMemory(id: number): any {
        const row = db.query('SELECT * FROM memories WHERE id = ?').get(id);
        if (!row) throw new Error(`Memory with id ${id} does not exist`);
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
     * T4 is unlimited — always returns true.
     * @param throwOnFull - if true, throws when tier is full and all are pinned; if false, returns false
     * @returns true if there is (or was made) capacity, false if no evictable memory
     */
    function ensureCapacity(space: string, tier: number, throwOnFull: boolean): boolean {
        const limit = TIER_LIMITS[tier as 1 | 2 | 3];
        if (limit === undefined) return true; // T4: unlimited

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

        // Evict LRU one tier down (no cascading — T3 LRU goes to T4 which is unlimited)
        const nextTier = tier + 1;
        db.run('UPDATE memories SET tier = ?, updated_at = ? WHERE id = ?', [nextTier, now(), lru.id]);
        return true;
    }

    // ── Spaces ──

    function createSpace(name: string, description: string, tags?: string[]): void {
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
            const stmt = db.prepare('INSERT OR IGNORE INTO space_tags (space_name, tag) VALUES (?, ?)');
            for (const tag of tags) {
                stmt.run(name, tag.toLowerCase().trim());
            }
        }
    }

    function getSpace(name: string): Space | null {
        const row = db.query('SELECT * FROM spaces WHERE name = ?').get(name) as any;
        if (!row) return null;
        return {
            name: row.name,
            description: row.description,
            tags: getTagsForSpace(row.name),
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
    }

    function listSpaces(filter?: { tag?: string }): SpaceSummary[] {
        let sql: string;
        let params: any[];

        if (filter?.tag) {
            sql = `
                SELECT s.name, s.description,
                       (SELECT COUNT(*) FROM memories m WHERE m.space_name = s.name) AS memory_count
                FROM spaces s
                JOIN space_tags st ON st.space_name = s.name AND st.tag = ?
                ORDER BY s.name
            `;
            params = [filter.tag.toLowerCase().trim()];
        } else {
            sql = `
                SELECT s.name, s.description,
                       (SELECT COUNT(*) FROM memories m WHERE m.space_name = s.name) AS memory_count
                FROM spaces s
                ORDER BY s.name
            `;
            params = [];
        }

        const rows = db.query(sql).all(...params) as any[];
        return rows.map((r) => ({
            name: r.name,
            description: r.description,
            tags: getTagsForSpace(r.name),
            memory_count: r.memory_count,
        }));
    }

    function updateSpace(name: string, updates: { description?: string }): void {
        requireSpace(name);
        if (updates.description !== undefined) {
            db.run('UPDATE spaces SET description = ?, updated_at = ? WHERE name = ?', [
                updates.description,
                now(),
                name,
            ]);
        }
    }

    function deleteSpace(name: string): void {
        requireSpace(name);
        // Clean FTS entries before cascade delete removes memories
        const mems = db.query('SELECT id FROM memories WHERE space_name = ?').all(name) as { id: number }[];
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
        db.run('INSERT OR IGNORE INTO space_tags (space_name, tag) VALUES (?, ?)', [
            space,
            tag.toLowerCase().trim(),
        ]);
    }

    function removeSpaceTag(space: string, tag: string): void {
        requireSpace(space);
        db.run('DELETE FROM space_tags WHERE space_name = ? AND tag = ?', [space, tag.toLowerCase().trim()]);
    }

    // ── Memories ──

    async function addMemory(
        space: string,
        name: string,
        content: string,
        opts?: { tags?: string[]; tier?: Tier }
    ): Promise<Memory> {
        requireSpace(space);

        const existing = db.query('SELECT 1 FROM memories WHERE space_name = ? AND name = ?').get(space, name);
        if (existing) throw new Error(`Memory "${name}" already exists in space "${space}"`);

        const tier = opts?.tier ?? 2;

        // Ensure capacity at target tier (evict LRU if needed); T4 is unlimited
        ensureCapacity(space, tier, true);

        const ts = now();
        const result = db.run(
            `INSERT INTO memories (space_name, name, content, tier, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [space, name, content, tier, ts, ts]
        );

        const id = Number(result.lastInsertRowid);
        ftsInsert(id, name, content);

        if (opts?.tags && opts.tags.length > 0) {
            const stmt = db.prepare('INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)');
            for (const tag of opts.tags) {
                stmt.run(id, tag.toLowerCase().trim());
            }
        }

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
        const row = db.query('SELECT * FROM memories WHERE space_name = ? AND name = ?').get(space, name) as any;
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

        let sql = 'SELECT m.id, m.name, m.tier, m.pinned, m.access_count FROM memories m';
        const joinParams: any[] = [];
        const conditions: string[] = ['m.space_name = ?'];
        const whereParams: any[] = [space];

        if (filter?.tag) {
            sql += ' JOIN memory_tags mt ON mt.memory_id = m.id AND mt.tag = ?';
            joinParams.push(filter.tag.toLowerCase().trim());
        }

        if (filter?.tier !== undefined) {
            // Explicit tier filter: return only that tier (T4 returns empty since it's never listed)
            if (filter.tier === 4) {
                return []; // T4 is never listed — use search instead
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
        return rows.map((r) => ({
            id: r.id,
            name: r.name,
            tier: r.tier as Tier,
            pinned: r.pinned === 1,
            tags: getTagsForMemory(r.id),
            access_count: r.access_count,
        }));
    }

    async function updateMemory(id: number, updates: { name?: string; content?: string }): Promise<void> {
        const row = requireMemory(id) as any;
        const sets: string[] = ['updated_at = ?'];
        const params: any[] = [now()];

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
        const row = requireMemory(id) as any;
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
        const ok = ensureCapacity(row.space_name, toTier, false);
        if (ok) {
            db.run('UPDATE memories SET tier = ?, updated_at = ? WHERE id = ?', [toTier, ts, id]);
        }
    }

    // ── Tags ──

    function addMemoryTag(memoryId: number, tag: string): void {
        requireMemory(memoryId);
        db.run('INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)', [
            memoryId,
            tag.toLowerCase().trim(),
        ]);
    }

    function removeMemoryTag(memoryId: number, tag: string): void {
        requireMemory(memoryId);
        db.run('DELETE FROM memory_tags WHERE memory_id = ? AND tag = ?', [memoryId, tag.toLowerCase().trim()]);
    }

    // ── Tiers ──

    function promote(id: number): void {
        const row = requireMemory(id) as any;
        if (row.tier <= 1) throw new Error('Memory is already at the highest tier');

        const toTier = row.tier - 1;
        // Throws if full and all are pinned
        ensureCapacity(row.space_name, toTier, true);
        db.run('UPDATE memories SET tier = ?, updated_at = ? WHERE id = ?', [toTier, now(), id]);
    }

    function demote(id: number): void {
        const row = requireMemory(id) as any;
        if (row.tier >= 4) throw new Error('Memory is already at the lowest tier');
        db.run('UPDATE memories SET tier = tier + 1, updated_at = ? WHERE id = ?', [now(), id]);
    }

    function pin(id: number): void {
        requireMemory(id);
        db.run('UPDATE memories SET pinned = 1, updated_at = ? WHERE id = ?', [now(), id]);
    }

    function unpin(id: number): void {
        requireMemory(id);
        db.run('UPDATE memories SET pinned = 0, updated_at = ? WHERE id = ?', [now(), id]);
    }

    // ── Links ──

    function linkMemories(sourceId: number, targetId: number, label?: string): void {
        requireMemory(sourceId);
        requireMemory(targetId);
        if (sourceId === targetId) throw new Error('Cannot link a memory to itself');

        db.run('INSERT OR REPLACE INTO links (source_id, target_id, label, created_at) VALUES (?, ?, ?, ?)', [
            sourceId,
            targetId,
            label ?? 'related',
            now(),
        ]);
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

        return rows.map((r) => ({
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
            .map((term) => {
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
                   fts.rank
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
            const tagLower = filter.tag.toLowerCase().trim();
            rows = rows.filter((r) => {
                const tags = getTagsForMemory(r.id);
                return tags.includes(tagLower);
            });
        }

        // If RAG is enabled, enrich and re-rank results with semantic similarity.
        // If FTS returned nothing, fall back to pure semantic search across all candidates.
        if (isRagEnabled()) {
            const getEmbeddingForId = (id: number): Float32Array | null => {
                const row = db.query('SELECT embedding FROM memories WHERE id = ?').get(id) as any;
                return row?.embedding ? blobToVector(row.embedding) : null;
            };

            // FTS returned results — re-rank by semantic similarity
            if (rows.length > 0) {
                const allIds = rows.map((r) => r.id);
                const semanticResults = await semanticSearch(query, getEmbeddingForId, allIds);
                const semanticMap = new Map(semanticResults.map((sr) => [sr.id, sr.score]));

                // Re-rank by semantic similarity (highest first)
                rows.sort((a, b) => (semanticMap.get(b.id) ?? 0) - (semanticMap.get(a.id) ?? 0));

                return rows.map((r) => ({
                    id: r.id,
                    space_name: r.space_name,
                    name: r.name,
                    content: r.content,
                    tier: r.tier as Tier,
                    pinned: r.pinned === 1,
                    tags: getTagsForMemory(r.id),
                    rank: r.rank,
                    similarity: semanticMap.get(r.id) ?? undefined,
                }));
            }

            // FTS returned nothing — fall back to pure semantic search across all candidates
            const SEMANTIC_FALLBACK_THRESHOLD = 0.3;
            let candSql = 'SELECT id, space_name, name, content, tier, pinned FROM memories WHERE 1=1';
            const candParams: any[] = [];
            if (filter?.space) { candSql += ' AND space_name = ?'; candParams.push(filter.space); }
            if (filter?.tier)  { candSql += ' AND tier = ?';       candParams.push(filter.tier); }
            let candidates = db.query(candSql).all(...candParams) as any[];
            if (filter?.tag) {
                const tagLower = filter.tag.toLowerCase().trim();
                candidates = candidates.filter((r) => getTagsForMemory(r.id).includes(tagLower));
            }

            const allIds = candidates.map((r: any) => r.id);
            const semanticResults = await semanticSearch(query, getEmbeddingForId, allIds);
            const goodResults = semanticResults.filter((sr) => sr.score >= SEMANTIC_FALLBACK_THRESHOLD);
            if (goodResults.length === 0) return [];

            const idToMem = new Map(candidates.map((r: any) => [r.id, r]));
            return goodResults.map((sr) => {
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
                };
            });
        }

        return rows.map((r) => ({
            id: r.id,
            space_name: r.space_name,
            name: r.name,
            content: r.content,
            tier: r.tier as Tier,
            pinned: r.pinned === 1,
            tags: getTagsForMemory(r.id),
            rank: r.rank,
            similarity: undefined, // Only populated when RAG is enabled
        }));
    }

    // ── Status ──

    function getStatus(space?: string): StatusResult {
        const spaceFilter = space ? 'WHERE space_name = ?' : '';
        const spaceParams: any[] = space ? [space] : [];

        const total_spaces = space
            ? 1
            : (db.query('SELECT COUNT(*) as c FROM spaces').get() as { c: number }).c;

        const total_memories = (
            db.query(`SELECT COUNT(*) as c FROM memories ${spaceFilter}`).get(...spaceParams) as { c: number }
        ).c;

        const tierRows = db
            .query(
                `SELECT tier, COUNT(*) as count, SUM(pinned) as pinned
                 FROM memories ${spaceFilter}
                 GROUP BY tier
                 ORDER BY tier`
            )
            .all(...spaceParams) as { tier: number; count: number; pinned: number }[];

        // Always return all 4 tiers
        const allTiers: Tier[] = [1, 2, 3, 4];
        const by_tier = allTiers.map((t) => {
            const row = tierRows.find((r) => r.tier === t);
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
        const embeddings_indexed = (
            db.query(embedSql).get(...embedParams) as { c: number }
        ).c;

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
                    db.run('INSERT INTO spaces (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)', [
                        spaceName,
                        spaceData.description,
                        ts,
                        ts,
                    ]);
                }

                for (const memory of spaceData.memories) {
                    const memName = memory.name || '(unnamed)';
                    const existingMem = db
                        .query('SELECT 1 FROM memories WHERE space_name = ? AND name = ?')
                        .get(spaceName, memName);
                    if (!existingMem) {
                        const ts = now();
                        const result = db.run(
                            `INSERT INTO memories (space_name, name, content, tier, created_at, updated_at)
                             VALUES (?, ?, ?, 2, ?, ?)`,
                            [spaceName, memName, memory.description ?? '', ts, ts]
                        );
                        ftsInsert(Number(result.lastInsertRowid), memName, memory.description ?? '');
                    }
                }
            }
        });

        transaction();
    }

    // ── Lifecycle ──

    function close(): void {
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
        updateMemory,
        deleteMemory,
        deleteMemoryByName,
        recordAccess,
        addMemoryTag,
        removeMemoryTag,
        promote,
        demote,
        pin,
        unpin,
        link: linkMemories,
        unlink: unlinkMemories,
        getLinks,
        search: searchMemories,
        getStatus,
        importFromJson,
        close,
    };
}
