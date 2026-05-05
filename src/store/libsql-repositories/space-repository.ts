// ── LibSQL SpaceRepository: handles all space operations ──

import type { Client } from '@libsql/client';

import { normalizeTag, normalizeTags } from '../../helpers/tags';
import type { Space, SpaceSummary } from '../../types';

export interface SpaceRepository {
  createSpace(name: string, description: string, tags?: string[]): Promise<void>;
  getSpace(name: string): Promise<Space | null>;
  listSpaces(filter?: { tag?: string; includeHidden?: boolean }): Promise<SpaceSummary[]>;
  updateSpace(name: string, updates: { description?: string; hidden?: boolean }): Promise<void>;
  deleteSpace(name: string): Promise<void>;
  renameSpace(oldName: string, newName: string): Promise<void>;
  addSpaceTag(space: string, tag: string): Promise<void>;
  removeSpaceTag(space: string, tag: string): Promise<void>;
}

export function createLibsqlSpaceRepository(client: Client): SpaceRepository {
  async function getTagsForSpace(spaceName: string): Promise<string[]> {
    const result = await client.execute({
      sql: 'SELECT tag FROM space_tags WHERE space_name = ?',
      args: [spaceName],
    });
    return result.rows.map((r: any) => r.tag as string);
  }

  async function createSpace(name: string, description: string, tags?: string[]): Promise<void> {
    if (!tags || tags.length === 0) {
      throw new Error('Tags are required and cannot be empty');
    }

    const existing = await client.execute({
      sql: 'SELECT 1 FROM spaces WHERE name = ?',
      args: [name],
    });
    if (existing.rows.length > 0) throw new Error(`Space "${name}" already exists`);

    const ts = new Date().toISOString();
    const statements = [
      {
        sql: 'INSERT INTO spaces (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)',
        args: [name, description, ts, ts],
      },
    ];

    if (tags && tags.length > 0) {
      const normalizedTags = normalizeTags(tags);
      for (const tag of normalizedTags) {
        statements.push({
          sql: 'INSERT OR IGNORE INTO space_tags (space_name, tag) VALUES (?, ?)',
          args: [name, tag],
        });
      }
    }

    await client.batch(statements, 'write');
  }

  async function getSpace(name: string): Promise<Space | null> {
    const result = await client.execute({
      sql: 'SELECT * FROM spaces WHERE name = ?',
      args: [name],
    });
    if (result.rows.length === 0) return null;

    const row = result.rows[0] as any;
    return {
      name: row.name,
      description: row.description,
      hidden: row.hidden !== 0,
      tags: await getTagsForSpace(row.name),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async function listSpaces(filter?: { tag?: string; includeHidden?: boolean }): Promise<SpaceSummary[]> {
    let sql: string;
    let args: unknown[];

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
      args = [normalizedFilter];
    } else {
      sql = `
        SELECT s.name, s.description, s.hidden,
               (SELECT COUNT(*) FROM memories m WHERE m.space_name = s.name) AS memory_count
        FROM spaces s
        ${includeHidden ? '' : 'WHERE s.hidden = 0'}
        ORDER BY s.name
      `;
      args = [];
    }

    const result = await client.execute({ sql, args: args as any[] });
    const summaries: SpaceSummary[] = [];

    for (const row of result.rows) {
      const r = row as any;
      const tags = await getTagsForSpace(r.name);
      summaries.push({
        name: r.name,
        description: r.description,
        hidden: r.hidden !== 0,
        tags,
        memory_count: Number(r.memory_count) || 0,
      });
    }

    return summaries;
  }

  async function updateSpace(
    name: string,
    updates: { description?: string; hidden?: boolean }
  ): Promise<void> {
    const row = await client.execute({
      sql: 'SELECT 1 FROM spaces WHERE name = ?',
      args: [name],
    });
    if (row.rows.length === 0) {
      throw new Error(`Space "${name}" does not exist. Create it first with space_create tool.`);
    }

    const ts = new Date().toISOString();
    const statements = [];

    if (updates.description !== undefined) {
      statements.push({
        sql: 'UPDATE spaces SET description = ?, updated_at = ? WHERE name = ?',
        args: [updates.description, ts, name],
      });
    }
    if (updates.hidden !== undefined) {
      statements.push({
        sql: 'UPDATE spaces SET hidden = ?, updated_at = ? WHERE name = ?',
        args: [updates.hidden ? 1 : 0, ts, name],
      });
    }

    if (statements.length > 0) {
      await client.batch(statements, 'write');
    }
  }

  async function deleteSpace(name: string): Promise<void> {
    const row = await client.execute({
      sql: 'SELECT 1 FROM spaces WHERE name = ?',
      args: [name],
    });
    if (row.rows.length === 0) {
      throw new Error(`Space "${name}" does not exist. Create it first with space_create tool.`);
    }

    // Delete all FTS entries before cascade delete removes memories
    const mems = await client.execute({
      sql: 'SELECT id FROM memories WHERE space_name = ?',
      args: [name],
    });

    const statements = [];

    // Delete FTS entries
    for (const m of mems.rows) {
      const mid = m as any;
      statements.push({
        sql: 'DELETE FROM memories_fts WHERE rowid = ?',
        args: [mid.id],
      });
    }

    // Delete space (cascades to space_tags and memories)
    statements.push({
      sql: 'DELETE FROM spaces WHERE name = ?',
      args: [name],
    });

    if (statements.length > 0) {
      await client.batch(statements, 'write');
    }
  }

  async function renameSpace(oldName: string, newName: string): Promise<void> {
    const row = await client.execute({
      sql: 'SELECT 1 FROM spaces WHERE name = ?',
      args: [oldName],
    });
    if (row.rows.length === 0) {
      throw new Error(`Space "${oldName}" does not exist. Create it first with space_create tool.`);
    }

    const existing = await client.execute({
      sql: 'SELECT 1 FROM spaces WHERE name = ?',
      args: [newName],
    });
    if (existing.rows.length > 0) {
      throw new Error(`Space "${newName}" already exists`);
    }

    const ts = new Date().toISOString();
    const statements = [
      {
        sql: 'UPDATE spaces SET name = ?, updated_at = ? WHERE name = ?',
        args: [newName, ts, oldName],
      },
    ];

    await client.batch(statements, 'write');
  }

  async function addSpaceTag(space: string, tag: string): Promise<void> {
    const row = await client.execute({
      sql: 'SELECT 1 FROM spaces WHERE name = ?',
      args: [space],
    });
    if (row.rows.length === 0) {
      throw new Error(`Space "${space}" does not exist. Create it first with space_create tool.`);
    }

    const normalized = normalizeTag(tag);
    await client.execute({
      sql: 'INSERT OR IGNORE INTO space_tags (space_name, tag) VALUES (?, ?)',
      args: [space, normalized],
    });
  }

  async function removeSpaceTag(space: string, tag: string): Promise<void> {
    const row = await client.execute({
      sql: 'SELECT 1 FROM spaces WHERE name = ?',
      args: [space],
    });
    if (row.rows.length === 0) {
      throw new Error(`Space "${space}" does not exist. Create it first with space_create tool.`);
    }

    const normalized = normalizeTag(tag);
    await client.execute({
      sql: 'DELETE FROM space_tags WHERE space_name = ? AND tag = ?',
      args: [space, normalized],
    });
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
