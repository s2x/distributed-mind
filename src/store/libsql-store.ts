// ── libSQL implementation of MindStore (schema v8, distributed/embedded-replica mode) ──
// This is the dimind backend. bun:sqlite stays in sqlite-store.ts.

import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';

import type {
  Space,
  SpaceSummary,
  Memory,
  MemorySummary,
  Link,
  Tier,
  SearchFilter,
  MemoryQueryFilter,
  SearchResult,
  StatusResult,
  SpaceGraphResult,
  LegacyBrain,
  HotMemorySummary,
  MemoryVersion,
} from '../types';
import type { MindStore, LinkedMemorySummary, MemoryPatchInput } from './mind-store';
import { createLibsqlSpaceRepository } from './libsql-repositories/space-repository';
import { createLibsqlLinkRepository } from './libsql-repositories/link-repository';
import { createLibsqlTagRepository, type TagRepository } from './libsql-repositories/tag-repository';
import { createLibsqlMemoryRepository, type MemoryRepository } from './libsql-repositories/memory-repository';
import {
  createLibsqlLogRepository,
  subscribeToLogs,
  unsubscribeFromLogs,
  type LogRepository,
} from './libsql-repositories/log-repository';
import { createLibsqlSearchRepository, type SearchRepository } from './libsql-repositories/search-repository';

// ── Schema v8 ──
// Fresh init only — not a migration of existing bun:sqlite data.
// Adds to v7: persistence/created_by/client_id columns on memories,
// and a new memory_versions table for audit trail of hard writes.

const LIBSQL_SCHEMA_VERSION = 8;

/**
 * Schema v8 DDL statements for libSQL.
 * Each element is a single SQL statement (libSQL does not support multi-statement strings).
 */
const LIBSQL_SCHEMA_V8_STATEMENTS: string[] = [
  // Version tracking
  `CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  // Spaces
  `CREATE TABLE IF NOT EXISTS spaces (
    name        TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    hidden      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS space_tags (
    space_name TEXT NOT NULL REFERENCES spaces(name) ON DELETE CASCADE ON UPDATE CASCADE,
    tag        TEXT NOT NULL,
    PRIMARY KEY (space_name, tag)
  )`,

  // Memories (tier 1=hot, 2=warm, 3=cold) — schema v8 adds persistence, created_by, client_id
  `CREATE TABLE IF NOT EXISTS memories (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    space_name       TEXT NOT NULL REFERENCES spaces(name) ON DELETE CASCADE ON UPDATE CASCADE,
    name             TEXT NOT NULL,
    content          TEXT NOT NULL DEFAULT '',
    tier             INTEGER NOT NULL DEFAULT 2 CHECK (tier BETWEEN 1 AND 3),
    pinned           INTEGER NOT NULL DEFAULT 0,
    access_count     INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    embedding        BLOB,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    changed_at       TEXT NOT NULL,
    persistence      TEXT NOT NULL DEFAULT 'soft' CHECK (persistence IN ('soft', 'hard')),
    created_by       TEXT,
    client_id        TEXT,
    UNIQUE(space_name, name)
  )`,

  `CREATE TABLE IF NOT EXISTS memory_tags (
    memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    tag       TEXT NOT NULL,
    PRIMARY KEY (memory_id, tag)
  )`,

  // Links between memories
  `CREATE TABLE IF NOT EXISTS links (
    source_id  INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    target_id  INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    label      TEXT NOT NULL DEFAULT 'related',
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id),
    CHECK (source_id != target_id)
  )`,

  // Full-text search (standalone, synced manually)
  `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    name, content,
    tokenize='porter unicode61'
  )`,

  // Indexes for common queries
  `CREATE INDEX IF NOT EXISTS idx_memories_space ON memories(space_name)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_space_tier ON memories(space_name, tier)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_persistence ON memories(persistence)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_client_id ON memories(client_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag)`,
  `CREATE INDEX IF NOT EXISTS idx_space_tags_tag ON space_tags(tag)`,
  `CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id)`,

  // Logs table for operation auditing
  `CREATE TABLE IF NOT EXISTS logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source        TEXT NOT NULL,
    operation     TEXT NOT NULL,
    level         TEXT DEFAULT 'info',
    input_data    TEXT,
    output_data   TEXT,
    error_message TEXT,
    caller_info   TEXT,
    duration_ms   INTEGER,
    timestamp     TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_logs_timestamp_source ON logs(timestamp, source)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_operation ON logs(operation)`,

  // Memory versions table — audit trail for hard writes (schema v8 addition)
  `CREATE TABLE IF NOT EXISTS memory_versions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id      INTEGER NOT NULL,
    space_name     TEXT NOT NULL,
    name           TEXT NOT NULL,
    content        TEXT NOT NULL,
    tags           TEXT,
    tier           INTEGER,
    persistence    TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    operation      TEXT NOT NULL CHECK (operation IN ('update', 'delete', 'revert', 'create')),
    changed_by     TEXT,
    client_id      TEXT,
    changed_at     TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_versions_memory_id   ON memory_versions(memory_id)`,
  `CREATE INDEX IF NOT EXISTS idx_versions_changed_at  ON memory_versions(changed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_versions_persistence ON memory_versions(persistence)`,
  `CREATE INDEX IF NOT EXISTS idx_versions_client_id   ON memory_versions(client_id)`,
  `CREATE INDEX IF NOT EXISTS idx_versions_operation   ON memory_versions(operation)`,
];

// ── Configuration ──

export interface LibsqlStoreConfig {
  /** e.g. 'file:./data/dimind.db' or 'libsql://team-brain.turso.io' */
  url: string;
  /** Turso/libSQL remote sync URL for embedded replica mode */
  syncUrl?: string;
  /** JWT auth token (deferred, optional for now) */
  authToken?: string;
  /**
   * Always 'number' to avoid BigInt in JS.
   * libSQL returns BigInt for INTEGER columns by default.
   */
  intMode?: 'number';
  /** DIMIND_CLIENT_ID — identifies this replica in multi-client setups */
  clientId?: string;
}

// ── Factory ──

export async function createLibsqlStore(config: LibsqlStoreConfig): Promise<MindStore> {
  const client = createClient({
    url: config.url,
    syncUrl: config.syncUrl,
    authToken: config.authToken,
    intMode: config.intMode ?? 'number',
  });

  await initializeLibsqlDatabase(client);

  return new LibsqlMindStore(client, config.clientId);
}

// ── Schema initialization ──

async function initializeLibsqlDatabase(client: Client): Promise<void> {
  // PRAGMA must be run as a separate execute() — some libSQL versions reject it in batch()
  await client.execute('PRAGMA foreign_keys = ON');

  // Check if already initialized by looking for the meta table
  try {
    const meta = await client.execute(
      "SELECT value FROM meta WHERE key = 'schema_version'"
    );
    if (meta.rows.length > 0) {
      // Already initialized — nothing more to do for now (migrations deferred to later phases)
      return;
    }
  } catch {
    // meta table doesn't exist yet — continue with fresh initialization
  }

  // Initialize fresh schema v8 using batch() for atomicity
  const statements = LIBSQL_SCHEMA_V8_STATEMENTS.map((sql) => ({ sql, args: [] as unknown[] }));
  await client.batch(statements as any, 'write');

  // Insert schema version
  await client.execute({
    sql: "INSERT INTO meta (key, value) VALUES ('schema_version', ?)",
    args: [String(LIBSQL_SCHEMA_VERSION)],
  });
}

// ── LibsqlMindStore class (stub implementations) ──

class LibsqlMindStore implements MindStore {
  private readonly spaceRepository;
  private readonly linkRepository;
  private readonly tagRepository: TagRepository;
  private readonly memoryRepository: MemoryRepository;
  private readonly logRepository: LogRepository;
  private readonly searchRepository: SearchRepository;

  constructor(
    private readonly client: Client,
    private readonly clientId?: string
  ) {
    this.spaceRepository = createLibsqlSpaceRepository(client);
    this.linkRepository = createLibsqlLinkRepository(client);
    this.tagRepository = createLibsqlTagRepository(client);
    this.memoryRepository = createLibsqlMemoryRepository(client, this.tagRepository, clientId);
    this.logRepository = createLibsqlLogRepository(client);
    this.searchRepository = createLibsqlSearchRepository(client);
  }

  // ── Spaces ──

  async createSpace(name: string, description: string, tags?: string[]): Promise<void> {
    return this.spaceRepository.createSpace(name, description, tags);
  }

  async getSpace(name: string): Promise<Space | null> {
    return this.spaceRepository.getSpace(name);
  }

  async listSpaces(filter?: { tag?: string; includeHidden?: boolean }): Promise<SpaceSummary[]> {
    return this.spaceRepository.listSpaces(filter);
  }

  async updateSpace(
    name: string,
    updates: { description?: string; hidden?: boolean }
  ): Promise<void> {
    return this.spaceRepository.updateSpace(name, updates);
  }

  async deleteSpace(name: string): Promise<void> {
    return this.spaceRepository.deleteSpace(name);
  }

  async renameSpace(oldName: string, newName: string): Promise<void> {
    return this.spaceRepository.renameSpace(oldName, newName);
  }

  async addSpaceTag(space: string, tag: string): Promise<void> {
    return this.spaceRepository.addSpaceTag(space, tag);
  }

  async removeSpaceTag(space: string, tag: string): Promise<void> {
    return this.spaceRepository.removeSpaceTag(space, tag);
  }

  // ── Memories ──

  async addMemory(
    space: string,
    name: string,
    content: string,
    opts?: { tags?: string[]; tier?: Tier; pinned?: boolean; linksToIds?: number[] }
  ): Promise<Memory> {
    return this.memoryRepository.addMemory(space, name, content, opts);
  }

  async getMemory(space: string, name: string): Promise<Memory | null> {
    return this.memoryRepository.getMemory(space, name);
  }

  async getMemoryById(id: number): Promise<Memory | null> {
    return this.memoryRepository.getMemoryById(id);
  }

  async listMemories(
    space: string,
    filter?: { tier?: Tier; tag?: string }
  ): Promise<MemorySummary[]> {
    return this.memoryRepository.listMemories(space, filter);
  }

  async getHotMemories(space: string): Promise<HotMemorySummary[]> {
    return this.memoryRepository.getHotMemories(space);
  }

  async updateMemory(id: number, updates: { name?: string; content?: string }): Promise<void> {
    return this.memoryRepository.updateMemory(id, updates);
  }

  async deleteMemory(id: number): Promise<void> {
    return this.memoryRepository.deleteMemory(id);
  }

  async deleteMemoryByName(space: string, name: string): Promise<void> {
    return this.memoryRepository.deleteMemoryByName(space, name);
  }

  async recordAccess(id: number): Promise<void> {
    return this.memoryRepository.recordAccess(id);
  }

  async getLinkedMemorySummaries(memoryId: number): Promise<{
    links_to: LinkedMemorySummary[];
    linked_by: LinkedMemorySummary[];
  }> {
    return this.memoryRepository.getLinkedMemorySummaries(memoryId);
  }

  async patchMemory(id: number, patch: MemoryPatchInput): Promise<Memory> {
    return this.memoryRepository.patchMemory(id, patch);
  }

  // ── Tags ──

  async addMemoryTag(memoryId: number, tag: string): Promise<void> {
    return this.tagRepository.addMemoryTag(memoryId, tag);
  }

  async removeMemoryTag(memoryId: number, tag: string): Promise<void> {
    return this.tagRepository.removeMemoryTag(memoryId, tag);
  }

  async setMemoryTags(memoryId: number, tags: string[]): Promise<void> {
    return this.tagRepository.setMemoryTags(memoryId, tags);
  }

  async listAllTags(): Promise<{
    spaces: { tag: string; count: number }[];
    memories: { tag: string; count: number }[];
  }> {
    return this.tagRepository.listAllTags();
  }

  // ── Tiers ──

  async promote(id: number): Promise<void> {
    return this.memoryRepository.promote(id);
  }

  async demote(id: number): Promise<void> {
    return this.memoryRepository.demote(id);
  }

  async pin(id: number): Promise<void> {
    return this.memoryRepository.pin(id);
  }

  async unpin(id: number): Promise<void> {
    return this.memoryRepository.unpin(id);
  }

  async promoteToHard(spaceName: string, memoryName: string): Promise<void> {
    return this.memoryRepository.promoteToHard(spaceName, memoryName);
  }

  async demoteToSoft(spaceName: string, memoryName: string): Promise<void> {
    return this.memoryRepository.demoteToSoft(spaceName, memoryName);
  }

  async getMemoryHistory(spaceName: string, memoryName: string): Promise<MemoryVersion[]> {
    return this.memoryRepository.getMemoryHistory(spaceName, memoryName);
  }

  // ── Links ──

  async link(sourceId: number, targetId: number, label?: string): Promise<void> {
    return this.linkRepository.linkMemories(sourceId, targetId, label);
  }

  async unlink(sourceId: number, targetId: number): Promise<void> {
    return this.linkRepository.unlinkMemories(sourceId, targetId);
  }

  async getLinks(memoryId: number): Promise<Link[]> {
    return this.linkRepository.getLinks(memoryId);
  }

  // ── Search ──

  async search(query: string, filter?: SearchFilter): Promise<SearchResult[]> {
    return this.searchRepository.searchMemories(query, filter);
  }

  async searchFallback(
    query: string,
    filter?: SearchFilter
  ): Promise<{ results: SearchResult[]; search_method: string }> {
    return this.searchRepository.searchFallback(query, filter);
  }

  async queryMemories(filter?: MemoryQueryFilter): Promise<MemorySummary[]> {
    return this.searchRepository.queryMemories(filter);
  }

  async queryMemoriesCount(filter: {
    space?: string;
    tag?: string;
    tier?: number;
    from?: string;
    to?: string;
  }): Promise<number> {
    return this.searchRepository.queryMemoriesCount(filter);
  }

  // ── Graph ──

  async getSpaceGraph(
    space: string,
    opts?: { limit?: number; maxLimit?: number }
  ): Promise<SpaceGraphResult> {
    return this.searchRepository.getSpaceGraph(space, opts);
  }

  // ── Status ──

  async getStatus(_space?: string): Promise<StatusResult> {
    throw new Error('not implemented: getStatus');
  }

  // ── Migration ──

  async importFromJson(brain: LegacyBrain): Promise<void> {
    return this.memoryRepository.importFromJson(brain);
  }

  async resolveMemoryRef(ref: string): Promise<{ space: string; name: string } | null> {
    return this.memoryRepository.resolveMemoryRef(ref);
  }

  // ── Logs ──

  async addLog(entry: {
    source: 'cli' | 'mcp' | 'api';
    operation: string;
    level?: 'info' | 'warn' | 'error';
    inputData?: Record<string, unknown>;
    outputData?: Record<string, unknown>;
    errorMessage?: string;
    callerInfo?: Record<string, unknown>;
    durationMs?: number;
  }): Promise<void> {
    return this.logRepository.addLog(entry);
  }

  async queryLogs(filter?: {
    source?: string;
    operation?: string;
    search?: string;
    from?: string;
    to?: string;
    level?: 'info' | 'warn' | 'error';
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
    since?: number;
  }): Promise<{ logs: unknown[]; total: number; limit: number; offset: number }> {
    return this.logRepository.queryLogs(filter);
  }

  async cleanupOldLogs(retentionMinutes: number): Promise<number> {
    return this.logRepository.cleanupOldLogs(retentionMinutes);
  }

  async clearAllLogs(): Promise<number> {
    return this.logRepository.clearAllLogs();
  }

  subscribeToLogs(sessionId: string, controller: unknown, filter?: string): void {
    subscribeToLogs(sessionId, controller as any, filter);
  }

  unsubscribeFromLogs(sessionId: string): void {
    unsubscribeFromLogs(sessionId);
  }

  // ── Sync (team mode) ──

  async sync(): Promise<void> {
    // libSQL client.sync() pulls latest changes from the primary
    if (typeof (this.client as any).sync === 'function') {
      await (this.client as any).sync();
    }
  }

  // ── Export/Import ──

  async exportToSql(): Promise<string> {
    const lines: string[] = [];
    const ts = new Date().toISOString();
    lines.push(`-- dimind export ${ts}`);
    lines.push(`-- schema version ${LIBSQL_SCHEMA_VERSION}`);
    lines.push('');

    // Escape a single value for SQL INSERT
    function sqlStr(v: unknown): string {
      if (v === null || v === undefined) return 'NULL';
      return `'${String(v).replace(/'/g, "''")}'`;
    }
    function sqlNum(v: unknown): string {
      if (v === null || v === undefined) return 'NULL';
      return String(Number(v));
    }

    // spaces
    const spacesResult = await this.client.execute('SELECT name, description, hidden, created_at, updated_at FROM spaces ORDER BY name');
    for (const r of spacesResult.rows) {
      const row = r as any;
      lines.push(
        `INSERT INTO spaces (name, description, hidden, created_at, updated_at) VALUES (${sqlStr(row.name)}, ${sqlStr(row.description)}, ${sqlNum(row.hidden)}, ${sqlStr(row.created_at)}, ${sqlStr(row.updated_at)});`
      );
    }
    if (spacesResult.rows.length > 0) lines.push('');

    // space_tags
    const spaceTagsResult = await this.client.execute('SELECT space_name, tag FROM space_tags ORDER BY space_name, tag');
    for (const r of spaceTagsResult.rows) {
      const row = r as any;
      lines.push(
        `INSERT INTO space_tags (space_name, tag) VALUES (${sqlStr(row.space_name)}, ${sqlStr(row.tag)});`
      );
    }
    if (spaceTagsResult.rows.length > 0) lines.push('');

    // memories (skip embedding — regenerated on demand)
    const memoriesResult = await this.client.execute(
      'SELECT space_name, name, content, tier, pinned, persistence, created_at, updated_at, changed_at FROM memories ORDER BY space_name, name'
    );
    for (const r of memoriesResult.rows) {
      const row = r as any;
      lines.push(
        `INSERT INTO memories (space_name, name, content, tier, pinned, persistence, created_at, updated_at, changed_at) VALUES (${sqlStr(row.space_name)}, ${sqlStr(row.name)}, ${sqlStr(row.content)}, ${sqlNum(row.tier)}, ${sqlNum(row.pinned)}, ${sqlStr(row.persistence ?? 'soft')}, ${sqlStr(row.created_at)}, ${sqlStr(row.updated_at)}, ${sqlStr(row.changed_at)});`
      );
    }
    if (memoriesResult.rows.length > 0) lines.push('');

    // memory_tags (join with memories to resolve name→id on import; store by space+name)
    const memTagsResult = await this.client.execute(`
      SELECT m.space_name, m.name AS memory_name, mt.tag
      FROM memory_tags mt
      JOIN memories m ON m.id = mt.memory_id
      ORDER BY m.space_name, m.name, mt.tag
    `);
    for (const r of memTagsResult.rows) {
      const row = r as any;
      lines.push(
        `-- memory_tag: ${sqlStr(row.space_name)}, ${sqlStr(row.memory_name)}, ${sqlStr(row.tag)}`
      );
    }
    if (memTagsResult.rows.length > 0) lines.push('');

    // links (store by space+name for portability)
    const linksResult = await this.client.execute(`
      SELECT src.space_name AS src_space, src.name AS src_name,
             tgt.space_name AS tgt_space, tgt.name AS tgt_name,
             l.label, l.created_at
      FROM links l
      JOIN memories src ON src.id = l.source_id
      JOIN memories tgt ON tgt.id = l.target_id
      ORDER BY src.space_name, src.name
    `);
    for (const r of linksResult.rows) {
      const row = r as any;
      lines.push(
        `-- link: ${sqlStr(row.src_space)}, ${sqlStr(row.src_name)}, ${sqlStr(row.tgt_space)}, ${sqlStr(row.tgt_name)}, ${sqlStr(row.label)}, ${sqlStr(row.created_at)}`
      );
    }

    return lines.join('\n') + '\n';
  }

  async importFromFile(
    filePath: string,
    options?: { asPersistence?: 'soft' | 'hard' }
  ): Promise<{ imported: number; errors: string[] }> {
    const { existsSync, readFileSync } = await import('fs');

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const persistence = options?.asPersistence ?? 'soft';

    // Detect format: SQL dump vs bun:sqlite .db file
    const content = readFileSync(filePath, 'utf8');
    if (content.startsWith('-- dimind export')) {
      return this._importFromSqlDump(content, persistence);
    }
    // Otherwise treat as a bun:sqlite mind.db file
    return this._importFromMindDb(filePath, persistence);
  }

  private async _importFromSqlDump(
    content: string,
    persistence: 'soft' | 'hard'
  ): Promise<{ imported: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;
    const ts = new Date().toISOString();

    // Parse spaces, memory_tags, and links from comment lines + INSERT statements
    const spacesInserted = new Set<string>();
    const memoriesInserted = new Map<string, number>(); // "space\0name" → id

    const lines = content.split('\n');
    const memoryTagLines: Array<{ spaceName: string; memoryName: string; tag: string }> = [];
    const linkLines: Array<{ srcSpace: string; srcName: string; tgtSpace: string; tgtName: string; label: string; createdAt: string }> = [];

    // Parse comment-encoded memory_tags and links
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-- memory_tag:')) {
        // -- memory_tag: 'space', 'mem', 'tag'
        const m = trimmed.match(/^-- memory_tag: '(.+?)', '(.+?)', '(.+?)'$/);
        if (m) {
          memoryTagLines.push({
            spaceName: m[1]!.replace(/''/g, "'"),
            memoryName: m[2]!.replace(/''/g, "'"),
            tag: m[3]!.replace(/''/g, "'"),
          });
        }
      } else if (trimmed.startsWith('-- link:')) {
        // -- link: 'src_space', 'src_name', 'tgt_space', 'tgt_name', 'label', 'created_at'
        const m = trimmed.match(/^-- link: '(.+?)', '(.+?)', '(.+?)', '(.+?)', '(.+?)', '(.+?)'$/);
        if (m) {
          linkLines.push({
            srcSpace: m[1]!.replace(/''/g, "'"),
            srcName: m[2]!.replace(/''/g, "'"),
            tgtSpace: m[3]!.replace(/''/g, "'"),
            tgtName: m[4]!.replace(/''/g, "'"),
            label: m[5]!.replace(/''/g, "'"),
            createdAt: m[6]!.replace(/''/g, "'"),
          });
        }
      }
    }

    // Parse INSERT INTO spaces ...
    const spaceRe = /^INSERT INTO spaces \(name, description, hidden, created_at, updated_at\) VALUES \('((?:[^']|'')*)', '((?:[^']|'')*)', (\d+), '((?:[^']|'')*)', '((?:[^']|'')*)'\);$/;
    // Parse INSERT INTO space_tags ...
    const spaceTagRe = /^INSERT INTO space_tags \(space_name, tag\) VALUES \('((?:[^']|'')*)', '((?:[^']|'')*)'\);$/;
    // Parse INSERT INTO memories ...
    const memRe = /^INSERT INTO memories \(space_name, name, content, tier, pinned, persistence, created_at, updated_at, changed_at\) VALUES \('((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', (\d+), (\d+), '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)'\);$/;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('--')) continue;

      const spaceMatch = trimmed.match(spaceRe);
      if (spaceMatch) {
        const [, name, description, hidden, created_at, updated_at] = spaceMatch;
        const spaceName = name!.replace(/''/g, "'");
        if (spacesInserted.has(spaceName)) continue;
        spacesInserted.add(spaceName);
        try {
          const existing = await this.client.execute({ sql: 'SELECT 1 FROM spaces WHERE name = ?', args: [spaceName] });
          if (existing.rows.length === 0) {
            await this.client.execute({
              sql: 'INSERT INTO spaces (name, description, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
              args: [spaceName, description!.replace(/''/g, "'"), Number(hidden), created_at!, updated_at!],
            });
          }
        } catch (e) {
          errors.push(`space ${spaceName}: ${e}`);
        }
        continue;
      }

      const spaceTagMatch = trimmed.match(spaceTagRe);
      if (spaceTagMatch) {
        const spaceName = spaceTagMatch[1]!.replace(/''/g, "'");
        const tag = spaceTagMatch[2]!.replace(/''/g, "'");
        try {
          await this.client.execute({
            sql: 'INSERT OR IGNORE INTO space_tags (space_name, tag) VALUES (?, ?)',
            args: [spaceName, tag],
          });
        } catch (e) {
          errors.push(`space_tag ${spaceName}/${tag}: ${e}`);
        }
        continue;
      }

      const memMatch = trimmed.match(memRe);
      if (memMatch) {
        const [, spaceName, name, content, tier, pinned, , created_at, updated_at, changed_at] = memMatch;
        const sName = spaceName!.replace(/''/g, "'");
        const mName = name!.replace(/''/g, "'");
        const mContent = content!.replace(/''/g, "'");
        try {
          const existing = await this.client.execute({
            sql: 'SELECT id FROM memories WHERE space_name = ? AND name = ?',
            args: [sName, mName],
          });
          let memId: number;
          if (existing.rows.length > 0) {
            memId = (existing.rows[0] as any).id as number;
          } else {
            const result = await this.client.execute({
              sql: 'INSERT INTO memories (space_name, name, content, tier, pinned, persistence, created_at, updated_at, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              args: [sName, mName, mContent, Number(tier), Number(pinned), persistence, created_at!, updated_at!, changed_at!],
            });
            memId = Number(result.lastInsertRowid);
            // Also insert into FTS
            try {
              await this.client.execute({
                sql: 'INSERT INTO memories_fts (rowid, name, content) VALUES (?, ?, ?)',
                args: [memId, mName, mContent],
              });
            } catch {
              // FTS insert failure is non-fatal
            }
            imported++;
          }
          memoriesInserted.set(`${sName}\0${mName}`, memId);
        } catch (e) {
          errors.push(`memory ${sName}/${mName}: ${e}`);
        }
        continue;
      }
    }

    // Insert memory_tags
    for (const { spaceName, memoryName, tag } of memoryTagLines) {
      const memId = memoriesInserted.get(`${spaceName}\0${memoryName}`);
      if (memId === undefined) continue;
      try {
        await this.client.execute({
          sql: 'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)',
          args: [memId, tag],
        });
      } catch (e) {
        errors.push(`memory_tag ${spaceName}/${memoryName}/${tag}: ${e}`);
      }
    }

    // Insert links
    for (const { srcSpace, srcName, tgtSpace, tgtName, label, createdAt } of linkLines) {
      const srcId = memoriesInserted.get(`${srcSpace}\0${srcName}`);
      const tgtId = memoriesInserted.get(`${tgtSpace}\0${tgtName}`);
      if (srcId === undefined || tgtId === undefined) continue;
      try {
        await this.client.execute({
          sql: 'INSERT OR IGNORE INTO links (source_id, target_id, label, created_at) VALUES (?, ?, ?, ?)',
          args: [srcId, tgtId, label, createdAt ?? ts],
        });
      } catch (e) {
        errors.push(`link ${srcSpace}/${srcName} → ${tgtSpace}/${tgtName}: ${e}`);
      }
    }

    return { imported, errors };
  }

  private async _importFromMindDb(
    filePath: string,
    persistence: 'soft' | 'hard'
  ): Promise<{ imported: number; errors: string[] }> {
    const { Database } = await import('bun:sqlite');
    const errors: string[] = [];
    let imported = 0;

    const srcDb = new Database(filePath, { readonly: true });
    const ts = new Date().toISOString();

    try {
      // Import spaces
      const spaces = srcDb.query('SELECT name, description, hidden, created_at, updated_at FROM spaces ORDER BY name').all() as any[];
      for (const s of spaces) {
        try {
          const existing = await this.client.execute({ sql: 'SELECT 1 FROM spaces WHERE name = ?', args: [s.name] });
          if (existing.rows.length === 0) {
            await this.client.execute({
              sql: 'INSERT INTO spaces (name, description, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
              args: [s.name, s.description ?? '', s.hidden ?? 0, s.created_at ?? ts, s.updated_at ?? ts],
            });
          }
        } catch (e) {
          errors.push(`space ${s.name}: ${e}`);
        }
      }

      // Import space_tags
      const spaceTags = srcDb.query('SELECT space_name, tag FROM space_tags ORDER BY space_name, tag').all() as any[];
      for (const st of spaceTags) {
        try {
          await this.client.execute({
            sql: 'INSERT OR IGNORE INTO space_tags (space_name, tag) VALUES (?, ?)',
            args: [st.space_name, st.tag],
          });
        } catch (e) {
          errors.push(`space_tag ${st.space_name}/${st.tag}: ${e}`);
        }
      }

      // Import memories (map old id → new id)
      const oldToNewId = new Map<number, number>();
      const memories = srcDb.query(
        'SELECT id, space_name, name, content, tier, pinned, created_at, updated_at, changed_at FROM memories ORDER BY id'
      ).all() as any[];
      for (const m of memories) {
        try {
          const existing = await this.client.execute({
            sql: 'SELECT id FROM memories WHERE space_name = ? AND name = ?',
            args: [m.space_name, m.name],
          });
          let newId: number;
          if (existing.rows.length > 0) {
            newId = (existing.rows[0] as any).id as number;
          } else {
            const changedAt = m.changed_at ?? m.updated_at ?? ts;
            const result = await this.client.execute({
              sql: 'INSERT INTO memories (space_name, name, content, tier, pinned, persistence, created_at, updated_at, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              args: [m.space_name, m.name, m.content ?? '', m.tier ?? 2, m.pinned ?? 0, persistence, m.created_at ?? ts, m.updated_at ?? ts, changedAt],
            });
            newId = Number(result.lastInsertRowid);
            // FTS
            try {
              await this.client.execute({
                sql: 'INSERT INTO memories_fts (rowid, name, content) VALUES (?, ?, ?)',
                args: [newId, m.name, m.content ?? ''],
              });
            } catch {
              // non-fatal
            }
            imported++;
          }
          oldToNewId.set(m.id as number, newId);
        } catch (e) {
          errors.push(`memory ${m.space_name}/${m.name}: ${e}`);
        }
      }

      // Import memory_tags
      const memTags = srcDb.query('SELECT memory_id, tag FROM memory_tags ORDER BY memory_id, tag').all() as any[];
      for (const mt of memTags) {
        const newId = oldToNewId.get(mt.memory_id as number);
        if (newId === undefined) continue;
        try {
          await this.client.execute({
            sql: 'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)',
            args: [newId, mt.tag],
          });
        } catch (e) {
          errors.push(`memory_tag id=${mt.memory_id}/${mt.tag}: ${e}`);
        }
      }

      // Import links
      const links = srcDb.query('SELECT source_id, target_id, label FROM links ORDER BY source_id').all() as any[];
      for (const l of links) {
        const newSrc = oldToNewId.get(l.source_id as number);
        const newTgt = oldToNewId.get(l.target_id as number);
        if (newSrc === undefined || newTgt === undefined) continue;
        try {
          await this.client.execute({
            sql: 'INSERT OR IGNORE INTO links (source_id, target_id, label, created_at) VALUES (?, ?, ?, ?)',
            args: [newSrc, newTgt, l.label ?? 'related', ts],
          });
        } catch (e) {
          errors.push(`link ${l.source_id} → ${l.target_id}: ${e}`);
        }
      }
    } finally {
      srcDb.close();
    }

    return { imported, errors };
  }

  // ── Lifecycle ──

  close(): void {
    this.client.close();
  }
}
