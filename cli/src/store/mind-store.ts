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
    TidyResult,
    GcResult,
    Stats,
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
    ): Memory;
    getMemory(space: string, name: string): Memory | null;
    getMemoryById(id: number): Memory | null;
    listMemories(space: string, filter?: { tier?: Tier; tag?: string }): MemorySummary[];
    updateMemory(id: number, updates: { name?: string; content?: string }): void;
    deleteMemory(id: number): void;
    deleteMemoryByName(space: string, name: string): void;
    recordAccess(id: number): void;

    // Tags
    addMemoryTag(memoryId: number, tag: string): void;
    removeMemoryTag(memoryId: number, tag: string): void;

    // Tiers
    promote(id: number): void;
    demote(id: number): void;
    pin(id: number): void;
    unpin(id: number): void;

    // Links
    link(sourceId: number, targetId: number, label?: string): void;
    unlink(sourceId: number, targetId: number): void;
    getLinks(memoryId: number): Link[];

    // Search
    search(query: string, filter?: SearchFilter): SearchResult[];

    // Maintenance
    tidy(space?: string): TidyResult;
    gc(maxAgeDays?: number): GcResult;
    stats(space?: string): Stats;

    // Migration
    importFromJson(brain: LegacyBrain): void;

    // Lifecycle
    close(): void;
}
