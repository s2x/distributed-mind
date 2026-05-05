// ── LibSQL SearchRepository: handles all search operations ──

import type { Client } from '@libsql/client';

import { blobToVector, isRagEnabled, semanticSearch } from '../../helpers/rag';
import { normalizeTag } from '../../helpers/tags';
import type { MemoryQueryFilter, MemorySummary, SearchResult, SpaceGraphResult, Tier } from '../../types';
import { normalizeDateBound, sanitizeFtsQuery } from '../shared';

export interface SearchRepository {
  searchMemories(
    query: string,
    filter?: { space?: string; tag?: string; tier?: Tier }
  ): Promise<SearchResult[]>;
  searchFallback(
    query: string,
    filter?: { space?: string; tag?: string; tier?: Tier }
  ): Promise<{ results: SearchResult[]; search_method: string }>;
  searchFts5(
    query: string,
    filter?: { space?: string; tag?: string; tier?: Tier }
  ): Promise<SearchResult[]>;
  searchLike(
    query: string,
    filter?: { space?: string; tag?: string; tier?: Tier }
  ): Promise<SearchResult[]>;
  searchSemantic(
    query: string,
    filter?: { space?: string; tag?: string; tier?: Tier }
  ): Promise<SearchResult[]>;
  queryMemories(filter?: MemoryQueryFilter): Promise<MemorySummary[]>;
  queryMemoriesCount(filter: {
    space?: string;
    tag?: string;
    tier?: number;
    from?: string;
    to?: string;
  }): Promise<number>;
  getSpaceGraph(
    space: string,
    opts?: { limit?: number; maxLimit?: number }
  ): Promise<SpaceGraphResult>;
}

export function createLibsqlSearchRepository(client: Client): SearchRepository {
  // ── Internal helpers ──

  async function getTagsForMemory(memoryId: number): Promise<string[]> {
    const result = await client.execute({
      sql: 'SELECT tag FROM memory_tags WHERE memory_id = ?',
      args: [memoryId],
    });
    return result.rows.map((r: any) => r.tag as string);
  }

  async function getEmbeddingForId(id: number): Promise<Float32Array | null> {
    const result = await client.execute({
      sql: 'SELECT embedding FROM memories WHERE id = ?',
      args: [id],
    });
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as any;
    if (!row.embedding) return null;
    // libSQL returns Uint8Array for BLOB columns; convert to Float32Array
    return blobToVector(row.embedding as Uint8Array);
  }

  function rowToSearchResult(r: any, tags: string[], similarityScore?: number): SearchResult {
    return {
      id: r.id as number,
      space_name: r.space_name as string,
      name: r.name as string,
      content: r.content as string,
      tier: r.tier as Tier,
      pinned: r.pinned !== 0,
      tags,
      rank: r.rank != null ? Number(r.rank) : 0,
      similarity: similarityScore,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
      changed_at: r.changed_at as string,
    };
  }

  // ── FTS5 search ──

  async function searchFts5(
    query: string,
    filter?: { space?: string; tag?: string; tier?: Tier }
  ): Promise<SearchResult[]> {
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];

    // libSQL FTS5 MATCH with parameter binding
    // Using string injection with sanitized query as a safety measure
    let sql = `
      SELECT m.id, m.space_name, m.name, m.content, m.tier, m.pinned,
             m.created_at, m.updated_at, m.changed_at, fts.rank
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ?
    `;
    const args: unknown[] = [sanitized];

    if (filter?.space) {
      sql += ' AND m.space_name = ?';
      args.push(filter.space);
    }
    if (filter?.tier) {
      sql += ' AND m.tier = ?';
      args.push(filter.tier);
    }

    sql += ' ORDER BY fts.rank';

    let result;
    try {
      result = await client.execute({ sql, args });
    } catch (_err) {
      // If parameter binding fails for FTS5 MATCH, fall back to string injection
      // (sanitized query has already had quotes/special chars stripped)
      const fallbackSql = `
        SELECT m.id, m.space_name, m.name, m.content, m.tier, m.pinned,
               m.created_at, m.updated_at, m.changed_at, fts.rank
        FROM memories_fts fts
        JOIN memories m ON m.id = fts.rowid
        WHERE memories_fts MATCH '${sanitized.replace(/'/g, '')}'
      ` + (filter?.space ? ' AND m.space_name = ?' : '')
        + (filter?.tier ? ' AND m.tier = ?' : '')
        + ' ORDER BY fts.rank';

      const fallbackArgs: unknown[] = [];
      if (filter?.space) fallbackArgs.push(filter.space);
      if (filter?.tier) fallbackArgs.push(filter.tier);

      result = await client.execute({ sql: fallbackSql, args: fallbackArgs });
    }

    let rows = result.rows as any[];

    // Post-filter by tag (requires subquery — done in JS to avoid complex SQL)
    if (filter?.tag) {
      const normalizedTag = normalizeTag(filter.tag);
      const filtered: any[] = [];
      for (const r of rows) {
        const tags = await getTagsForMemory(r.id as number);
        if (tags.includes(normalizedTag)) {
          filtered.push(r);
        }
      }
      rows = filtered;
    }

    return Promise.all(
      rows.map(async r => {
        const tags = await getTagsForMemory(r.id as number);
        return rowToSearchResult(r, tags);
      })
    );
  }

  // ── LIKE fallback search ──

  async function searchLike(
    query: string,
    filter?: { space?: string; tag?: string; tier?: Tier }
  ): Promise<SearchResult[]> {
    const likePattern = `%${query}%`;

    let sql = `
      SELECT m.id, m.space_name, m.name, m.content, m.tier, m.pinned,
             m.created_at, m.updated_at, m.changed_at
      FROM memories m
      WHERE (m.name LIKE ? OR m.content LIKE ?)
    `;
    const args: unknown[] = [likePattern, likePattern];

    if (filter?.space) {
      sql += ' AND m.space_name = ?';
      args.push(filter.space);
    }
    if (filter?.tier) {
      sql += ' AND m.tier = ?';
      args.push(filter.tier);
    }

    sql += ' ORDER BY m.changed_at DESC, m.id DESC';

    const result = await client.execute({ sql, args });
    let rows = result.rows as any[];

    // Post-filter by tag
    if (filter?.tag) {
      const normalizedTag = normalizeTag(filter.tag);
      const filtered: any[] = [];
      for (const r of rows) {
        const tags = await getTagsForMemory(r.id as number);
        if (tags.includes(normalizedTag)) {
          filtered.push(r);
        }
      }
      rows = filtered;
    }

    return Promise.all(
      rows.map(async r => {
        const tags = await getTagsForMemory(r.id as number);
        return rowToSearchResult(r, tags);
      })
    );
  }

  // ── Semantic search ──

  async function searchSemantic(
    query: string,
    filter?: { space?: string; tag?: string; tier?: Tier }
  ): Promise<SearchResult[]> {
    if (!isRagEnabled()) return [];

    const SEMANTIC_FALLBACK_THRESHOLD = 0.3;

    let candSql =
      'SELECT id, space_name, name, content, tier, pinned, created_at, updated_at, changed_at FROM memories WHERE 1=1';
    const candArgs: unknown[] = [];

    if (filter?.space) {
      candSql += ' AND space_name = ?';
      candArgs.push(filter.space);
    }
    if (filter?.tier) {
      candSql += ' AND tier = ?';
      candArgs.push(filter.tier);
    }

    const candResult = await client.execute({ sql: candSql, args: candArgs });
    let candidates = candResult.rows as any[];

    if (filter?.tag) {
      const normalizedTag = normalizeTag(filter.tag);
      const filtered: any[] = [];
      for (const r of candidates) {
        const tags = await getTagsForMemory(r.id as number);
        if (tags.includes(normalizedTag)) {
          filtered.push(r);
        }
      }
      candidates = filtered;
    }

    const allIds = candidates.map((r: any) => r.id as number);

    // Build a sync wrapper around the async getEmbeddingForId
    // semanticSearch expects a sync function, so we prefetch all embeddings
    const embeddingMap = new Map<number, Float32Array>();
    await Promise.all(
      allIds.map(async (id: number) => {
        const emb = await getEmbeddingForId(id);
        if (emb) embeddingMap.set(id, emb);
      })
    );

    const semanticResults = await semanticSearch(
      query,
      (id: number) => embeddingMap.get(id) ?? null,
      allIds
    );

    const goodResults = semanticResults.filter(sr => sr.score >= SEMANTIC_FALLBACK_THRESHOLD);
    if (goodResults.length === 0) return [];

    const idToMem = new Map(candidates.map((r: any) => [r.id as number, r]));

    return Promise.all(
      goodResults.map(async sr => {
        const r = idToMem.get(sr.id)!;
        const tags = await getTagsForMemory(sr.id);
        return {
          id: r.id as number,
          space_name: r.space_name as string,
          name: r.name as string,
          content: r.content as string,
          tier: r.tier as Tier,
          pinned: r.pinned !== 0,
          tags,
          rank: 0,
          similarity: sr.score,
          created_at: r.created_at as string,
          updated_at: r.updated_at as string,
          changed_at: r.changed_at as string,
        };
      })
    );
  }

  // ── Main search (hybrid when RAG enabled) ──

  async function searchMemories(
    query: string,
    filter?: { space?: string; tag?: string; tier?: Tier }
  ): Promise<SearchResult[]> {
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];

    // Get FTS5 results first
    const ftsRows = await searchFts5(query, filter);

    if (!isRagEnabled()) {
      return ftsRows;
    }

    const normalizeScores = (values: number[]): number[] => {
      if (values.length === 0) return [];
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (min === max) return values.map(() => 1);
      return values.map(value => (value - min) / (max - min));
    };

    if (ftsRows.length > 0) {
      // FTS returned results — re-rank by semantic similarity (hybrid)
      const HYBRID_FTS_WEIGHT = 0.65;
      const HYBRID_SEMANTIC_WEIGHT = 0.35;

      const allIds = ftsRows.map(r => r.id);

      // Prefetch embeddings
      const embeddingMap = new Map<number, Float32Array>();
      await Promise.all(
        allIds.map(async (id: number) => {
          const emb = await getEmbeddingForId(id);
          if (emb) embeddingMap.set(id, emb);
        })
      );

      const semanticResults = await semanticSearch(
        query,
        (id: number) => embeddingMap.get(id) ?? null,
        allIds
      );

      const semanticMap = new Map(semanticResults.map(sr => [sr.id, sr.score]));
      const rankMap = new Map(ftsRows.map(row => [row.id, Number(row.rank) || 0]));

      const normalizedFts = normalizeScores(ftsRows.map(row => -(Number(row.rank) || 0)));
      const normalizedSemantic = normalizeScores(ftsRows.map(row => semanticMap.get(row.id) ?? 0));
      const hybridScore = new Map<number, number>();

      for (let index = 0; index < ftsRows.length; index++) {
        const row = ftsRows[index]!;
        const score =
          (normalizedFts[index] ?? 0) * HYBRID_FTS_WEIGHT +
          (normalizedSemantic[index] ?? 0) * HYBRID_SEMANTIC_WEIGHT;
        hybridScore.set(row.id, score);
      }

      // Re-rank by hybrid score (highest first), deterministic tie-breakers
      const sorted = [...ftsRows].sort((a, b) => {
        const byHybrid = (hybridScore.get(b.id) ?? 0) - (hybridScore.get(a.id) ?? 0);
        if (byHybrid !== 0) return byHybrid;
        const byRank = (rankMap.get(a.id) ?? 0) - (rankMap.get(b.id) ?? 0);
        if (byRank !== 0) return byRank;
        return a.id - b.id;
      });

      return sorted.map(r => ({
        ...r,
        similarity: semanticMap.get(r.id) ?? undefined,
      }));
    }

    // FTS returned nothing — fall back to pure semantic search across all candidates
    const SEMANTIC_FALLBACK_THRESHOLD = 0.3;

    let candSql =
      'SELECT id, space_name, name, content, tier, pinned, created_at, updated_at, changed_at FROM memories WHERE 1=1';
    const candArgs: unknown[] = [];

    if (filter?.space) {
      candSql += ' AND space_name = ?';
      candArgs.push(filter.space);
    }
    if (filter?.tier) {
      candSql += ' AND tier = ?';
      candArgs.push(filter.tier);
    }

    const candResult = await client.execute({ sql: candSql, args: candArgs });
    let candidates = candResult.rows as any[];

    if (filter?.tag) {
      const normalizedTag = normalizeTag(filter.tag);
      const filtered: any[] = [];
      for (const r of candidates) {
        const tags = await getTagsForMemory(r.id as number);
        if (tags.includes(normalizedTag)) {
          filtered.push(r);
        }
      }
      candidates = filtered;
    }

    const allIds = candidates.map((r: any) => r.id as number);

    // Prefetch embeddings
    const embeddingMap = new Map<number, Float32Array>();
    await Promise.all(
      allIds.map(async (id: number) => {
        const emb = await getEmbeddingForId(id);
        if (emb) embeddingMap.set(id, emb);
      })
    );

    const semanticResults = await semanticSearch(
      query,
      (id: number) => embeddingMap.get(id) ?? null,
      allIds
    );

    const goodResults = semanticResults.filter(sr => sr.score >= SEMANTIC_FALLBACK_THRESHOLD);
    if (goodResults.length === 0) return [];

    const idToMem = new Map(candidates.map((r: any) => [r.id as number, r]));

    return Promise.all(
      goodResults.map(async sr => {
        const r = idToMem.get(sr.id)!;
        const tags = await getTagsForMemory(sr.id);
        return {
          id: r.id as number,
          space_name: r.space_name as string,
          name: r.name as string,
          content: r.content as string,
          tier: r.tier as Tier,
          pinned: r.pinned !== 0,
          tags,
          rank: 0,
          similarity: sr.score,
          created_at: r.created_at as string,
          updated_at: r.updated_at as string,
          changed_at: r.changed_at as string,
        };
      })
    );
  }

  // ── searchFallback: FTS5 → LIKE → Semantic ──

  async function searchFallback(
    query: string,
    filter?: { space?: string; tag?: string; tier?: Tier }
  ): Promise<{ results: SearchResult[]; search_method: string }> {
    // Step 1: Try FTS5
    const ftsResults = await searchFts5(query, filter);
    if (ftsResults.length > 0) {
      return { results: ftsResults, search_method: 'fts5' };
    }

    // Step 2: FTS returned nothing — try LIKE fallback
    const likeResults = await searchLike(query, filter);
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

  // ── queryMemories ──

  async function queryMemories(filter?: MemoryQueryFilter): Promise<MemorySummary[]> {
    let sql =
      'SELECT m.id, m.space_name, m.name, m.tier, m.pinned, m.access_count, m.created_at, m.updated_at, m.changed_at FROM memories m';
    const joinArgs: unknown[] = [];
    const conditions: string[] = [];
    const whereArgs: unknown[] = [];

    if (filter?.tag) {
      sql += ' JOIN memory_tags mt ON mt.memory_id = m.id AND mt.tag = ?';
      joinArgs.push(normalizeTag(filter.tag));
    }

    if (filter?.space) {
      conditions.push('m.space_name = ?');
      whereArgs.push(filter.space);
    }

    if (filter?.tier !== undefined) {
      conditions.push('m.tier = ?');
      whereArgs.push(filter.tier);
    }

    if (filter?.from) {
      conditions.push('m.changed_at >= ?');
      whereArgs.push(normalizeDateBound(filter.from, false));
    }

    if (filter?.to) {
      conditions.push('m.changed_at <= ?');
      whereArgs.push(normalizeDateBound(filter.to, true));
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const limit = Math.max(1, Math.min(500, filter?.limit ?? 25));
    const offset = Math.max(0, filter?.offset ?? 0);

    sql += ' ORDER BY m.changed_at DESC, m.id DESC LIMIT ? OFFSET ?';

    const args: unknown[] = [...joinArgs, ...whereArgs, limit, offset];
    const result = await client.execute({ sql, args });

    return Promise.all(
      (result.rows as any[]).map(async r => {
        const tags = await getTagsForMemory(r.id as number);
        return {
          id: r.id as number,
          space_name: r.space_name as string,
          name: r.name as string,
          tier: r.tier as Tier,
          pinned: r.pinned !== 0,
          tags,
          access_count: r.access_count as number,
          created_at: r.created_at as string,
          updated_at: r.updated_at as string,
          changed_at: r.changed_at as string,
        };
      })
    );
  }

  // ── queryMemoriesCount ──

  async function queryMemoriesCount(filter: {
    space?: string;
    tag?: string;
    tier?: number;
    from?: string;
    to?: string;
  }): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM memories m';
    const joinArgs: unknown[] = [];
    const conditions: string[] = [];
    const whereArgs: unknown[] = [];

    if (filter?.tag) {
      sql += ' JOIN memory_tags mt ON mt.memory_id = m.id AND mt.tag = ?';
      joinArgs.push(normalizeTag(filter.tag));
    }

    if (filter?.space) {
      conditions.push('m.space_name = ?');
      whereArgs.push(filter.space);
    }

    if (filter?.tier !== undefined) {
      conditions.push('m.tier = ?');
      whereArgs.push(filter.tier);
    }

    if (filter?.from) {
      conditions.push('m.changed_at >= ?');
      whereArgs.push(normalizeDateBound(filter.from, false));
    }

    if (filter?.to) {
      conditions.push('m.changed_at <= ?');
      whereArgs.push(normalizeDateBound(filter.to, true));
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const args: unknown[] = [...joinArgs, ...whereArgs];
    const result = await client.execute({ sql, args });
    const row = result.rows[0] as any;
    return Number(row.count) || 0;
  }

  // ── getSpaceGraph ──

  async function getSpaceGraph(
    space: string,
    opts?: { limit?: number; maxLimit?: number }
  ): Promise<SpaceGraphResult> {
    // Verify the space exists
    const spaceCheck = await client.execute({
      sql: 'SELECT 1 FROM spaces WHERE name = ?',
      args: [space],
    });
    if (spaceCheck.rows.length === 0) {
      throw new Error(`Space "${space}" does not exist. Create it first with space_create tool.`);
    }

    const requestedLimit = opts?.limit ?? 300;
    const maxLimit = opts?.maxLimit ?? 1000;
    const normalizedRequestedLimit = Math.max(1, Math.trunc(requestedLimit));
    const appliedLimit = Math.min(normalizedRequestedLimit, Math.max(1, Math.trunc(maxLimit)));

    // Get total count (tier < 4 means all valid tiers 1-3)
    const totalResult = await client.execute({
      sql: 'SELECT COUNT(*) as total FROM memories WHERE space_name = ? AND tier < 4',
      args: [space],
    });
    const totalNodes = Number((totalResult.rows[0] as any).total) || 0;

    // Get paginated memories ordered by tier, access_count, name
    const memResult = await client.execute({
      sql: `SELECT id, name, tier
            FROM memories
            WHERE space_name = ? AND tier < 4
            ORDER BY tier ASC, access_count DESC, name ASC
            LIMIT ?`,
      args: [space, appliedLimit],
    });

    const rows = memResult.rows as { id: number; name: string; tier: Tier }[];

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
      const linkArgs: unknown[] = [space, space, ...selectedIds, ...selectedIds];

      const linkResult = await client.execute({
        sql: `SELECT l.source_id, l.target_id
              FROM links l
              JOIN memories sm ON sm.id = l.source_id
              JOIN memories tm ON tm.id = l.target_id
              WHERE sm.space_name = ?
                AND tm.space_name = ?
                AND (l.source_id IN (${placeholders}) OR l.target_id IN (${placeholders}))`,
        args: linkArgs,
      });

      for (const linkRow of linkResult.rows as any[]) {
        const sourceNode = nodeMap.get(linkRow.source_id as number);
        if (sourceNode) sourceNode.links_to.push(linkRow.target_id as number);

        const targetNode = nodeMap.get(linkRow.target_id as number);
        if (targetNode) targetNode.linked_by.push(linkRow.source_id as number);
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

  return {
    searchMemories,
    searchFallback,
    searchFts5,
    searchLike,
    searchSemantic,
    queryMemories,
    queryMemoriesCount,
    getSpaceGraph,
  };
}
