// ── LinkRepository: handles all link operations ──

import type { Database } from 'bun:sqlite';

import type { Link } from '../../types';
import { requireMemory } from '../shared';

export interface LinkRepository {
  linkMemories(sourceId: number, targetId: number, label?: string): void;
  unlinkMemories(sourceId: number, targetId: number): void;
  getLinks(memoryId: number): Link[];
}

export function createLinkRepository(db: Database): LinkRepository {
  function linkMemories(sourceId: number, targetId: number, label?: string): void {
    requireMemory(db, sourceId);
    requireMemory(db, targetId);
    if (sourceId === targetId) throw new Error('Cannot link a memory to itself');

    const ts = new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
    db.run(
      'INSERT OR REPLACE INTO links (source_id, target_id, label, created_at) VALUES (?, ?, ?, ?)',
      [sourceId, targetId, label ?? 'related', ts]
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

  return {
    linkMemories,
    unlinkMemories,
    getLinks,
  };
}
