// ── SpaceRepository: handles all space operations ──

import type { Database } from 'bun:sqlite';

import { normalizeTag, normalizeTags } from '../../helpers/tags';
import type { Space, SpaceSummary } from '../../types';
import { FtsHelper } from '../shared';

export interface SpaceRepository {
  createSpace(name: string, description: string, tags?: string[]): void;
  getSpace(name: string): Space | null;
  listSpaces(filter?: { tag?: string; includeHidden?: boolean }): SpaceSummary[];
  updateSpace(name: string, updates: { description?: string; hidden?: boolean }): void;
  deleteSpace(name: string): void;
  renameSpace(oldName: string, newName: string): void;
  addSpaceTag(space: string, tag: string): void;
  removeSpaceTag(space: string, tag: string): void;
}

export function createSpaceRepository(db: Database, fts: FtsHelper): SpaceRepository {
  function getTagsForSpace(spaceName: string): string[] {
    const rows = db.query('SELECT tag FROM space_tags WHERE space_name = ?').all(spaceName) as {
      tag: string;
    }[];
    return rows.map(r => r.tag);
  }

  function createSpace(name: string, description: string, tags?: string[]): void {
    if (!tags || tags.length === 0) {
      throw new Error('Tags are required and cannot be empty');
    }

    const existing = db.query('SELECT 1 FROM spaces WHERE name = ?').get(name);
    if (existing) throw new Error(`Space "${name}" already exists`);

    const ts = new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
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
    const row = db.query('SELECT 1 FROM spaces WHERE name = ?').get(name);
    if (!row)
      throw new Error(`Space "${name}" does not exist. Create it first with space_create tool.`);

    const ts = new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
    if (updates.description !== undefined) {
      db.run('UPDATE spaces SET description = ?, updated_at = ? WHERE name = ?', [
        updates.description,
        ts,
        name,
      ]);
    }
    if (updates.hidden !== undefined) {
      db.run('UPDATE spaces SET hidden = ?, updated_at = ? WHERE name = ?', [
        updates.hidden ? 1 : 0,
        ts,
        name,
      ]);
    }
  }

  function deleteSpace(name: string): void {
    const row = db.query('SELECT 1 FROM spaces WHERE name = ?').get(name);
    if (!row)
      throw new Error(`Space "${name}" does not exist. Create it first with space_create tool.`);

    // Clean FTS entries before cascade delete removes memories
    const mems = db.query('SELECT id FROM memories WHERE space_name = ?').all(name) as {
      id: number;
    }[];
    for (const m of mems) fts.delete(m.id);
    db.run('DELETE FROM spaces WHERE name = ?', [name]);
  }

  function renameSpace(oldName: string, newName: string): void {
    const row = db.query('SELECT 1 FROM spaces WHERE name = ?').get(oldName);
    if (!row)
      throw new Error(`Space "${oldName}" does not exist. Create it first with space_create tool.`);

    const existing = db.query('SELECT 1 FROM spaces WHERE name = ?').get(newName);
    if (existing) throw new Error(`Space "${newName}" already exists`);

    const ts = new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
    db.run('UPDATE spaces SET name = ?, updated_at = ? WHERE name = ?', [newName, ts, oldName]);
  }

  function addSpaceTag(space: string, tag: string): void {
    const row = db.query('SELECT 1 FROM spaces WHERE name = ?').get(space);
    if (!row)
      throw new Error(`Space "${space}" does not exist. Create it first with space_create tool.`);

    const normalized = normalizeTag(tag);
    db.run('INSERT OR IGNORE INTO space_tags (space_name, tag) VALUES (?, ?)', [space, normalized]);
  }

  function removeSpaceTag(space: string, tag: string): void {
    const row = db.query('SELECT 1 FROM spaces WHERE name = ?').get(space);
    if (!row)
      throw new Error(`Space "${space}" does not exist. Create it first with space_create tool.`);

    const normalized = normalizeTag(tag);
    db.run('DELETE FROM space_tags WHERE space_name = ? AND tag = ?', [space, normalized]);
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
  };
}
