// ── LibSQL TagRepository: handles all tag operations ──

import type { Client } from '@libsql/client';

import { normalizeTag, normalizeTags } from '../../helpers/tags';

export interface TagRepository {
  addMemoryTag(memoryId: number, tag: string): Promise<void>;
  removeMemoryTag(memoryId: number, tag: string): Promise<void>;
  setMemoryTags(memoryId: number, tags: string[]): Promise<void>;
  listAllTags(): Promise<{
    spaces: { tag: string; count: number }[];
    memories: { tag: string; count: number }[];
  }>;
}

export function createLibsqlTagRepository(client: Client): TagRepository {
  async function addMemoryTag(memoryId: number, tag: string): Promise<void> {
    const normalized = normalizeTag(tag);
    await client.execute({
      sql: 'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)',
      args: [memoryId, normalized],
    });
  }

  async function removeMemoryTag(memoryId: number, tag: string): Promise<void> {
    const normalized = normalizeTag(tag);
    await client.execute({
      sql: 'DELETE FROM memory_tags WHERE memory_id = ? AND tag = ?',
      args: [memoryId, normalized],
    });
  }

  async function setMemoryTags(memoryId: number, tags: string[]): Promise<void> {
    const statements: Array<{ sql: string; args: unknown[] }> = [];

    // Clear existing tags
    statements.push({
      sql: 'DELETE FROM memory_tags WHERE memory_id = ?',
      args: [memoryId],
    });

    // Add new tags
    if (tags.length > 0) {
      const normalizedTags = normalizeTags(tags);
      for (const tag of normalizedTags) {
        statements.push({
          sql: 'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)',
          args: [memoryId, tag],
        });
      }
    }

    await client.batch(statements, 'write');
  }

  async function listAllTags(): Promise<{
    spaces: { tag: string; count: number }[];
    memories: { tag: string; count: number }[];
  }> {
    const spaceTagsResult = await client.execute({
      sql: 'SELECT tag, COUNT(*) as count FROM space_tags GROUP BY tag ORDER BY tag',
      args: [],
    });

    const memoryTagsResult = await client.execute({
      sql: 'SELECT tag, COUNT(*) as count FROM memory_tags GROUP BY tag ORDER BY tag',
      args: [],
    });

    const spaces = spaceTagsResult.rows.map((r: any) => ({
      tag: r.tag as string,
      count: Number(r.count) || 0,
    }));

    const memories = memoryTagsResult.rows.map((r: any) => ({
      tag: r.tag as string,
      count: Number(r.count) || 0,
    }));

    return { spaces, memories };
  }

  return {
    addMemoryTag,
    removeMemoryTag,
    setMemoryTags,
    listAllTags,
  };
}
