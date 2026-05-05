// ── LibSQL LinkRepository: handles all link operations ──

import type { Client } from '@libsql/client';

import type { Link } from '../../types';
import { now } from '../shared/datetime-helpers';

export interface LinkRepository {
  linkMemories(sourceId: number, targetId: number, label?: string): Promise<void>;
  unlinkMemories(sourceId: number, targetId: number): Promise<void>;
  getLinks(memoryId: number): Promise<Link[]>;
}

export function createLibsqlLinkRepository(client: Client): LinkRepository {
  async function linkMemories(
    sourceId: number,
    targetId: number,
    label?: string
  ): Promise<void> {
    // Validate that both memories exist
    const sourceResult = await client.execute({
      sql: 'SELECT 1 FROM memories WHERE id = ?',
      args: [sourceId],
    });
    if (sourceResult.rows.length === 0) {
      throw new Error(
        `Memory with id ${sourceId} does not exist. Use memory_query or search to find valid IDs.`
      );
    }

    const targetResult = await client.execute({
      sql: 'SELECT 1 FROM memories WHERE id = ?',
      args: [targetId],
    });
    if (targetResult.rows.length === 0) {
      throw new Error(
        `Memory with id ${targetId} does not exist. Use memory_query or search to find valid IDs.`
      );
    }

    if (sourceId === targetId) {
      throw new Error('Cannot link a memory to itself');
    }

    const ts = now();
    await client.execute({
      sql: 'INSERT OR REPLACE INTO links (source_id, target_id, label, created_at) VALUES (?, ?, ?, ?)',
      args: [sourceId, targetId, label ?? 'related', ts],
    });
  }

  async function unlinkMemories(sourceId: number, targetId: number): Promise<void> {
    await client.execute({
      sql: 'DELETE FROM links WHERE source_id = ? AND target_id = ?',
      args: [sourceId, targetId],
    });
  }

  async function getLinks(memoryId: number): Promise<Link[]> {
    const result = await client.execute({
      sql: `SELECT l.*,
                   sm.name as source_name, sm.space_name as source_space,
                   tm.name as target_name, tm.space_name as target_space
            FROM links l
            JOIN memories sm ON sm.id = l.source_id
            JOIN memories tm ON tm.id = l.target_id
            WHERE l.source_id = ? OR l.target_id = ?
            ORDER BY l.created_at DESC`,
      args: [memoryId, memoryId],
    });

    return result.rows.map((r: any) => ({
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
