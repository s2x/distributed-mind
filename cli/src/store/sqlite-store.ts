// ── SQLite implementation of MindStore ──

import { Database } from 'bun:sqlite';
import { initializeDatabase } from './schema';
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
    TidyResult,
    GcResult,
    Stats,
    LegacyBrain,
} from '../types';

// ── Tier auto-promotion thresholds ──
const PROMOTE_3_TO_2_ON_READ = true;
const PROMOTE_2_TO_1_ACCESS_THRESHOLD = 5;
const PROMOTE_2_TO_1_DAYS_WINDOW = 7;

// ── Tidy thresholds (days without access) ──
const TIDY_TIER1_DAYS = 14;
const TIDY_TIER2_DAYS = 30;
const GC_DEFAULT_DAYS = 90;

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
        // For standalone FTS tables, just delete by rowid
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

    function addMemory(
        space: string,
        name: string,
        content: string,
        opts?: { tags?: string[]; tier?: Tier }
    ): Memory {
        requireSpace(space);

        const existing = db.query('SELECT 1 FROM memories WHERE space_name = ? AND name = ?').get(space, name);
        if (existing) throw new Error(`Memory "${name}" already exists in space "${space}"`);

        const tier = opts?.tier ?? 2;
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

        return rowToMemory(db.query('SELECT * FROM memories WHERE id = ?').get(id));
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
        if (filter?.tier) {
            conditions.push('m.tier = ?');
            whereParams.push(filter.tier);
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

    function updateMemory(id: number, updates: { name?: string; content?: string }): void {
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

        db.run(
            'UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?, updated_at = ? WHERE id = ?',
            [ts, ts, id]
        );

        // Auto-promotion
        if (row.pinned) return;

        const currentTier = row.tier as Tier;

        if (currentTier === 3 && PROMOTE_3_TO_2_ON_READ) {
            db.run('UPDATE memories SET tier = 2 WHERE id = ?', [id]);
        } else if (currentTier === 2) {
            // Promote to 1 if accessed enough times recently
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - PROMOTE_2_TO_1_DAYS_WINDOW);
            const cutoffStr = cutoff.toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

            // We use access_count as a rough proxy.
            // A more precise approach would track individual accesses, but this is good enough.
            const newCount = row.access_count + 1;
            if (newCount >= PROMOTE_2_TO_1_ACCESS_THRESHOLD && row.last_accessed_at && row.last_accessed_at >= cutoffStr) {
                db.run('UPDATE memories SET tier = 1 WHERE id = ?', [id]);
            }
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
        db.run('UPDATE memories SET tier = tier - 1, updated_at = ? WHERE id = ?', [now(), id]);
    }

    function demote(id: number): void {
        const row = requireMemory(id) as any;
        if (row.tier >= 3) throw new Error('Memory is already at the lowest tier');
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

    function searchMemories(query: string, filter?: SearchFilter): SearchResult[] {
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

        return rows.map((r) => ({
            id: r.id,
            space_name: r.space_name,
            name: r.name,
            content: r.content,
            tier: r.tier as Tier,
            pinned: r.pinned === 1,
            tags: getTagsForMemory(r.id),
            rank: r.rank,
        }));
    }

    // ── Maintenance ──

    function tidy(space?: string): TidyResult {
        const ts = now();
        const demoted: TidyResult['demoted'] = [];
        const candidates_for_gc: TidyResult['candidates_for_gc'] = [];

        // Demote tier 1 → 2 (not accessed in TIDY_TIER1_DAYS days, not pinned)
        const cutoff1 = new Date();
        cutoff1.setDate(cutoff1.getDate() - TIDY_TIER1_DAYS);
        const cutoff1Str = cutoff1.toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

        let sql1 = `SELECT * FROM memories WHERE tier = 1 AND pinned = 0
                     AND (last_accessed_at IS NULL OR last_accessed_at < ?)`;
        const params1: any[] = [cutoff1Str];
        if (space) {
            sql1 += ' AND space_name = ?';
            params1.push(space);
        }

        const tier1Rows = db.query(sql1).all(...params1) as any[];
        for (const row of tier1Rows) {
            db.run('UPDATE memories SET tier = 2, updated_at = ? WHERE id = ?', [ts, row.id]);
            demoted.push({ id: row.id, name: row.name, space: row.space_name, from_tier: 1, to_tier: 2 });
        }

        // Demote tier 2 → 3 (not accessed in TIDY_TIER2_DAYS days, not pinned)
        const cutoff2 = new Date();
        cutoff2.setDate(cutoff2.getDate() - TIDY_TIER2_DAYS);
        const cutoff2Str = cutoff2.toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

        let sql2 = `SELECT * FROM memories WHERE tier = 2 AND pinned = 0
                     AND (last_accessed_at IS NULL OR last_accessed_at < ?)`;
        const params2: any[] = [cutoff2Str];
        if (space) {
            sql2 += ' AND space_name = ?';
            params2.push(space);
        }

        const tier2Rows = db.query(sql2).all(...params2) as any[];
        for (const row of tier2Rows) {
            db.run('UPDATE memories SET tier = 3, updated_at = ? WHERE id = ?', [ts, row.id]);
            demoted.push({ id: row.id, name: row.name, space: row.space_name, from_tier: 2, to_tier: 3 });
        }

        // Identify GC candidates (tier 3, very old)
        const cutoff3 = new Date();
        cutoff3.setDate(cutoff3.getDate() - GC_DEFAULT_DAYS);
        const cutoff3Str = cutoff3.toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

        let sql3 = `SELECT id, name, space_name, last_accessed_at FROM memories WHERE tier = 3 AND pinned = 0
                     AND (last_accessed_at IS NULL OR last_accessed_at < ?)`;
        const params3: any[] = [cutoff3Str];
        if (space) {
            sql3 += ' AND space_name = ?';
            params3.push(space);
        }

        const gcRows = db.query(sql3).all(...params3) as any[];
        for (const row of gcRows) {
            candidates_for_gc.push({
                id: row.id,
                name: row.name,
                space: row.space_name,
                last_accessed_at: row.last_accessed_at,
            });
        }

        return { demoted, candidates_for_gc };
    }

    function gc(maxAgeDays?: number): GcResult {
        const days = maxAgeDays ?? GC_DEFAULT_DAYS;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

        const rows = db
            .query(
                `SELECT id, name, space_name FROM memories WHERE tier = 3 AND pinned = 0
                 AND (last_accessed_at IS NULL OR last_accessed_at < ?)`
            )
            .all(cutoffStr) as any[];

        const removed: GcResult['removed'] = [];
        for (const row of rows) {
            ftsDelete(row.id);
            db.run('DELETE FROM memories WHERE id = ?', [row.id]);
            removed.push({ id: row.id, name: row.name, space: row.space_name });
        }

        return { removed };
    }

    function getStats(space?: string): Stats {
        const spaceFilter = space ? ' WHERE space_name = ?' : '';
        const spaceParams = space ? [space] : [];

        const totalSpaces = (
            db.query('SELECT COUNT(*) as count FROM spaces').get() as { count: number }
        ).count;

        const totalMemories = (
            db.query(`SELECT COUNT(*) as count FROM memories${spaceFilter}`).all(...spaceParams) as any[]
        )[0].count;

        const byTier = db
            .query(`SELECT tier, COUNT(*) as count FROM memories${spaceFilter} GROUP BY tier ORDER BY tier`)
            .all(...spaceParams) as { tier: number; count: number }[];

        const mostAccessed = db
            .query(
                `SELECT id, name, space_name, access_count FROM memories${spaceFilter}
                 ORDER BY access_count DESC LIMIT 10`
            )
            .all(...spaceParams) as any[];

        const leastAccessed = db
            .query(
                `SELECT id, name, space_name, last_accessed_at FROM memories${spaceFilter}
                 ORDER BY COALESCE(last_accessed_at, '1970-01-01') ASC LIMIT 10`
            )
            .all(...spaceParams) as any[];

        return {
            total_spaces: space ? 1 : totalSpaces,
            total_memories: totalMemories,
            by_tier: byTier.map((r) => ({ tier: r.tier as Tier, count: r.count })),
            most_accessed: mostAccessed.map((r) => ({
                id: r.id,
                name: r.name,
                space: r.space_name,
                access_count: r.access_count,
            })),
            least_accessed: leastAccessed.map((r) => ({
                id: r.id,
                name: r.name,
                space: r.space_name,
                last_accessed_at: r.last_accessed_at,
            })),
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
        tidy,
        gc,
        stats: getStats,
        importFromJson,
        close,
    };
}
