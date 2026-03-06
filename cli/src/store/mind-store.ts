// ── MindStore interface ──

import type {
    Space,
    SpaceSummary,
    Memory,
    MemorySummary,
    Link,
    Tier,
    SearchFilter,
    SearchResult,
    StatusResult,
    LegacyBrain,
} from '../types';

export interface MindStore {
    // Spaces
    createSpace(name: string, description: string, tags?: string[]): void;
    getSpace(name: string): Space | null;
    listSpaces(filter?: { tag?: string }): SpaceSummary[];
    updateSpace(name: string, updates: { description?: string }): void;
    deleteSpace(name: string): void;
    renameSpace(oldName: string, newName: string): void;
    addSpaceTag(space: string, tag: string): void;
    removeSpaceTag(space: string, tag: string): void;

    // Memories
    addMemory(
        space: string,
        name: string,
        content: string,
        opts?: { tags?: string[]; tier?: Tier }
    ): Promise<Memory>;
    getMemory(space: string, name: string): Memory | null;
    getMemoryById(id: number): Memory | null;
    /**
     * List memories in a space.
     * Default (no tier filter): returns T1 + T2 only.
     * T4 is never returned by list — use search to find frozen memories.
     */
    listMemories(space: string, filter?: { tier?: Tier; tag?: string }): MemorySummary[];
    updateMemory(id: number, updates: { name?: string; content?: string }): Promise<void>;
    deleteMemory(id: number): void;
    deleteMemoryByName(space: string, name: string): void;
    /**
     * Record an access (bumps count + last_accessed_at).
     * Also auto-promotes non-pinned memories one tier up (with LRU eviction if destination is full).
     * Silently skips promotion if destination is full and all are pinned.
     */
    recordAccess(id: number): void;

    // Tags
    addMemoryTag(memoryId: number, tag: string): void;
    removeMemoryTag(memoryId: number, tag: string): void;

    // Tiers
    /**
     * Promote memory one tier up (T4→T3, T3→T2, T2→T1).
     * Evicts LRU non-pinned from destination if full.
     * Throws if already at T1 or destination is full and all are pinned.
     */
    promote(id: number): void;
    /**
     * Demote memory one tier down (T1→T2, T2→T3, T3→T4).
     * Throws if already at T4.
     */
    demote(id: number): void;
    pin(id: number): void;
    unpin(id: number): void;

    // Links
    link(sourceId: number, targetId: number, label?: string): void;
    unlink(sourceId: number, targetId: number): void;
    getLinks(memoryId: number): Link[];

    // Search (T4 memories ARE included in search results)
    // When RAG is enabled, returns FTS results merged with semantic similarity scores
    search(query: string, filter?: SearchFilter): Promise<SearchResult[]>;

    // Status
    getStatus(space?: string): StatusResult;

    // Migration
    importFromJson(brain: LegacyBrain): void;

    // Lifecycle
    close(): void;
}
