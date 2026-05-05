// ── MindStore interface ──

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

export interface LinkedMemorySummary {
  id: number;
  name: string;
  space_name: string;
  changed_at: string;
  tier: Tier;
  tags: string[];
  pinned: boolean;
}

export interface MemoryPatchInput {
  name?: string;
  content?: string;
  pinned?: boolean;
  tierTransition?: 'promote' | 'demote';
  addTags?: string[];
  removeTags?: string[];
  addLinksToIds?: number[];
  removeLinksToIds?: number[];
}

export interface MindStore {
  // Spaces
  createSpace(name: string, description: string, tags?: string[]): Promise<void>;
  getSpace(name: string): Promise<Space | null>;
  listSpaces(filter?: { tag?: string; includeHidden?: boolean }): Promise<SpaceSummary[]>;
  updateSpace(name: string, updates: { description?: string; hidden?: boolean }): Promise<void>;
  deleteSpace(name: string): Promise<void>;
  renameSpace(oldName: string, newName: string): Promise<void>;
  addSpaceTag(space: string, tag: string): Promise<void>;
  removeSpaceTag(space: string, tag: string): Promise<void>;

  // Memories
  addMemory(
    space: string,
    name: string,
    content: string,
    opts?: {
      tags?: string[];
      tier?: Tier;
      pinned?: boolean;
      linksToIds?: number[];
      persistence?: 'soft' | 'hard';
    }
  ): Promise<Memory>;
  getMemory(space: string, name: string): Promise<Memory | null>;
  getMemoryById(id: number): Promise<Memory | null>;
  /**
   * List memories in a space.
   * Default (no tier filter): returns T1 + T2 only.
   * Passing tier 3 will return T3 memories.
   * T4 has been removed — listing with tier=3 or no filter only.
   */
  listMemories(space: string, filter?: { tier?: Tier; tag?: string }): Promise<MemorySummary[]>;
  /**
   * Get hot (T1 + T2) memories as summaries for a space.
   * Used by MCP tools to provide a fast overview without full content.
   */
  getHotMemories(space: string): Promise<HotMemorySummary[]>;
  updateMemory(id: number, updates: { name?: string; content?: string }): Promise<void>;
  deleteMemory(id: number): Promise<void>;
  deleteMemoryByName(space: string, name: string): Promise<void>;
  /**
   * Record an access (bumps count + last_accessed_at).
   * Also auto-promotes non-pinned memories one tier up (with LRU eviction if destination is full).
   * Silently skips promotion if destination is full and all are pinned.
   */
  recordAccess(id: number): Promise<void>;
  getLinkedMemorySummaries(memoryId: number): Promise<{
    links_to: LinkedMemorySummary[];
    linked_by: LinkedMemorySummary[];
  }>;
  patchMemory(id: number, patch: MemoryPatchInput): Promise<Memory>;

  // Tags
  addMemoryTag(memoryId: number, tag: string): Promise<void>;
  removeMemoryTag(memoryId: number, tag: string): Promise<void>;
  setMemoryTags(memoryId: number, tags: string[]): Promise<void>;
  listAllTags(): Promise<{
    spaces: { tag: string; count: number }[];
    memories: { tag: string; count: number }[];
  }>;

  // Tiers
  /**
   * Promote memory one tier up (T3→T2, T2→T1).
   * Evicts LRU non-pinned from destination if full.
   * Throws if already at T1 or destination is full and all are pinned.
   */
  promote(id: number): Promise<void>;
  /**
   * Demote memory one tier down (T1→T2, T2→T3).
   * Throws if already at lowest tier (T3).
   */
  demote(id: number): Promise<void>;
  pin(id: number): Promise<void>;
  unpin(id: number): Promise<void>;

  // Persistence (libSQL / distributed mode only)
  /**
   * Mark a memory as hard-persistent: exempt from LRU eviction and tier limits.
   * Not available on bun:sqlite backend — throws "not supported".
   */
  promoteToHard(spaceName: string, memoryName: string): Promise<void>;
  /**
   * Mark a memory as soft-persistent: subject to LRU eviction and tier limits.
   * Not available on bun:sqlite backend — throws "not supported".
   */
  demoteToSoft(spaceName: string, memoryName: string): Promise<void>;

  /**
   * Get the version history for a memory (from memory_versions table).
   * Returns an empty array if the memory doesn't exist or has no history.
   * Optional — only implemented on the libSQL backend.
   */
  getMemoryHistory?(spaceName: string, memoryName: string): Promise<MemoryVersion[]>;

  // Links
  link(sourceId: number, targetId: number, label?: string): Promise<void>;
  unlink(sourceId: number, targetId: number): Promise<void>;
  getLinks(memoryId: number): Promise<Link[]>;

  // Search (T4 memories are no longer applicable - T3 is unlimited)
  // When RAG is enabled, returns FTS results merged with semantic similarity scores
  search(query: string, filter?: SearchFilter): Promise<SearchResult[]>;

  // Search with fallback chain: FTS5 → LIKE → embeddings; returns results + search_method
  searchFallback(
    query: string,
    filter?: SearchFilter
  ): Promise<{ results: SearchResult[]; search_method: string }>;

  // Query memories by metadata/date with pagination
  queryMemories(filter?: MemoryQueryFilter): Promise<MemorySummary[]>;

  // Count memories matching the given filters (without fetching all rows)
  queryMemoriesCount(filter: {
    space?: string;
    tag?: string;
    tier?: number;
    from?: string;
    to?: string;
  }): Promise<number>;

  // Graph view (includes T1..T3 only)
  getSpaceGraph(space: string, opts?: { limit?: number; maxLimit?: number }): Promise<SpaceGraphResult>;

  // Status
  getStatus(space?: string): Promise<StatusResult>;

  // Migration
  importFromJson(brain: LegacyBrain): Promise<void>;
  /**
   * Parse a memory reference string "space:name" into its components.
   * Returns null if the format is invalid (no colon, empty space, or empty name).
   */
  resolveMemoryRef(ref: string): Promise<{ space: string; name: string } | null>;

  // Logs
  addLog(entry: {
    source: 'cli' | 'mcp' | 'api';
    operation: string;
    level?: 'info' | 'warn' | 'error';
    inputData?: Record<string, unknown>;
    outputData?: Record<string, unknown>;
    errorMessage?: string;
    callerInfo?: Record<string, unknown>;
    durationMs?: number;
  }): Promise<void>;
  queryLogs(filter?: {
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
  }): Promise<{ logs: any[]; total: number; limit: number; offset: number }>;
  cleanupOldLogs(retentionMinutes: number): Promise<number>;
  clearAllLogs(): Promise<number>;
  subscribeToLogs(sessionId: string, controller: any, filter?: string): void;
  unsubscribeFromLogs(sessionId: string): void;

  // Sync (team mode only)
  /**
   * Sync with team primary (push buffered writes + pull latest).
   * Only available in team mode (LibSQL backend with syncUrl).
   */
  sync?(): Promise<void>;

  // Export/Import (dimind only)
  /**
   * Export all data as SQL INSERT statements for portability.
   * Embeddings are skipped (they can be regenerated).
   * Only available on the libSQL backend.
   */
  exportToSql?(): Promise<string>;

  /**
   * Import data from a file.
   * Supports:
   *   - SQL dumps produced by exportToSql() (detected by header comment)
   *   - Legacy mind.db (bun:sqlite file) when filePath ends in .db
   * Only available on the libSQL backend.
   */
  importFromFile?(
    filePath: string,
    options?: { asPersistence?: 'soft' | 'hard' }
  ): Promise<{ imported: number; errors: string[] }>;

  // Lifecycle
  close(): void;
}
