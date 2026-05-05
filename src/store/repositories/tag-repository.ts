// ── TagRepository: handles all tag operations ──

import type { Database } from 'bun:sqlite';

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

export function createTagRepository(db: Database): TagRepository {
  async function addMemoryTag(memoryId: number, tag: string): Promise<void> {
    const normalized = normalizeTag(tag);
    db.run('INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)', [
      memoryId,
      normalized,
    ]);
  }

  async function removeMemoryTag(memoryId: number, tag: string): Promise<void> {
    const normalized = normalizeTag(tag);
    db.run('DELETE FROM memory_tags WHERE memory_id = ? AND tag = ?', [memoryId, normalized]);
  }

  async function setMemoryTags(memoryId: number, tags: string[]): Promise<void> {
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
  }

  async function listAllTags(): Promise<{
    spaces: { tag: string; count: number }[];
    memories: { tag: string; count: number }[];
  }> {
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

  return {
    addMemoryTag,
    removeMemoryTag,
    setMemoryTags,
    listAllTags,
  };
}
