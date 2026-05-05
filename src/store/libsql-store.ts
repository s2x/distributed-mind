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
} from '../types';
import type { MindStore, LinkedMemorySummary, MemoryPatchInput } from './mind-store';
import { createLibsqlSpaceRepository } from './libsql-repositories/space-repository';
import { createLibsqlLinkRepository } from './libsql-repositories/link-repository';
import {
  createLibsqlLogRepository,
  subscribeToLogs,
  unsubscribeFromLogs,
  type LogRepository,
} from './libsql-repositories/log-repository';

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
  await client.batch(statements, 'write');

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
  private readonly logRepository: LogRepository;

  constructor(
    private readonly client: Client,
    private readonly clientId?: string
  ) {
    this.spaceRepository = createLibsqlSpaceRepository(client);
    this.linkRepository = createLibsqlLinkRepository(client);
    this.logRepository = createLibsqlLogRepository(client);
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
    _space: string,
    _name: string,
    _content: string,
    _opts?: { tags?: string[]; tier?: Tier; pinned?: boolean; linksToIds?: number[] }
  ): Promise<Memory> {
    throw new Error('not implemented: addMemory');
  }

  async getMemory(_space: string, _name: string): Promise<Memory | null> {
    throw new Error('not implemented: getMemory');
  }

  async getMemoryById(_id: number): Promise<Memory | null> {
    throw new Error('not implemented: getMemoryById');
  }

  async listMemories(
    _space: string,
    _filter?: { tier?: Tier; tag?: string }
  ): Promise<MemorySummary[]> {
    throw new Error('not implemented: listMemories');
  }

  async getHotMemories(_space: string): Promise<HotMemorySummary[]> {
    throw new Error('not implemented: getHotMemories');
  }

  async updateMemory(_id: number, _updates: { name?: string; content?: string }): Promise<void> {
    throw new Error('not implemented: updateMemory');
  }

  async deleteMemory(_id: number): Promise<void> {
    throw new Error('not implemented: deleteMemory');
  }

  async deleteMemoryByName(_space: string, _name: string): Promise<void> {
    throw new Error('not implemented: deleteMemoryByName');
  }

  async recordAccess(_id: number): Promise<void> {
    throw new Error('not implemented: recordAccess');
  }

  async getLinkedMemorySummaries(_memoryId: number): Promise<{
    links_to: LinkedMemorySummary[];
    linked_by: LinkedMemorySummary[];
  }> {
    throw new Error('not implemented: getLinkedMemorySummaries');
  }

  async patchMemory(_id: number, _patch: MemoryPatchInput): Promise<Memory> {
    throw new Error('not implemented: patchMemory');
  }

  // ── Tags ──

  async addMemoryTag(_memoryId: number, _tag: string): Promise<void> {
    throw new Error('not implemented: addMemoryTag');
  }

  async removeMemoryTag(_memoryId: number, _tag: string): Promise<void> {
    throw new Error('not implemented: removeMemoryTag');
  }

  async setMemoryTags(_memoryId: number, _tags: string[]): Promise<void> {
    throw new Error('not implemented: setMemoryTags');
  }

  async listAllTags(): Promise<{
    spaces: { tag: string; count: number }[];
    memories: { tag: string; count: number }[];
  }> {
    throw new Error('not implemented: listAllTags');
  }

  // ── Tiers ──

  async promote(_id: number): Promise<void> {
    throw new Error('not implemented: promote');
  }

  async demote(_id: number): Promise<void> {
    throw new Error('not implemented: demote');
  }

  async pin(_id: number): Promise<void> {
    throw new Error('not implemented: pin');
  }

  async unpin(_id: number): Promise<void> {
    throw new Error('not implemented: unpin');
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

  async search(_query: string, _filter?: SearchFilter): Promise<SearchResult[]> {
    throw new Error('not implemented: search');
  }

  async searchFallback(
    _query: string,
    _filter?: SearchFilter
  ): Promise<{ results: SearchResult[]; search_method: string }> {
    throw new Error('not implemented: searchFallback');
  }

  async queryMemories(_filter?: MemoryQueryFilter): Promise<MemorySummary[]> {
    throw new Error('not implemented: queryMemories');
  }

  async queryMemoriesCount(_filter: {
    space?: string;
    tag?: string;
    tier?: number;
    from?: string;
    to?: string;
  }): Promise<number> {
    throw new Error('not implemented: queryMemoriesCount');
  }

  // ── Graph ──

  async getSpaceGraph(
    _space: string,
    _opts?: { limit?: number; maxLimit?: number }
  ): Promise<SpaceGraphResult> {
    throw new Error('not implemented: getSpaceGraph');
  }

  // ── Status ──

  async getStatus(_space?: string): Promise<StatusResult> {
    throw new Error('not implemented: getStatus');
  }

  // ── Migration ──

  async importFromJson(_brain: LegacyBrain): Promise<void> {
    throw new Error('not implemented: importFromJson');
  }

  async resolveMemoryRef(_ref: string): Promise<{ space: string; name: string } | null> {
    throw new Error('not implemented: resolveMemoryRef');
  }

  // ── Logs ──

  async addLog(_entry: {
    source: 'cli' | 'mcp' | 'api';
    operation: string;
    level?: 'info' | 'warn' | 'error';
    inputData?: Record<string, unknown>;
    outputData?: Record<string, unknown>;
    errorMessage?: string;
    callerInfo?: Record<string, unknown>;
    durationMs?: number;
  }): Promise<void> {
    throw new Error('not implemented: addLog');
  }

  async queryLogs(_filter?: {
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
    throw new Error('not implemented: queryLogs');
  }

  async cleanupOldLogs(_retentionMinutes: number): Promise<number> {
    throw new Error('not implemented: cleanupOldLogs');
  }

  async clearAllLogs(): Promise<number> {
    throw new Error('not implemented: clearAllLogs');
  }

  subscribeToLogs(_sessionId: string, _controller: unknown, _filter?: string): void {
    throw new Error('not implemented: subscribeToLogs');
  }

  unsubscribeFromLogs(_sessionId: string): void {
    throw new Error('not implemented: unsubscribeFromLogs');
  }

  // ── Lifecycle ──

  close(): void {
    this.client.close();
  }
}
