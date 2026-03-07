// ── Core domain types for Mind v2 ──

export interface Space {
    name: string;
    description: string;
    tags: string[];
    hidden: boolean;
    created_at: string;
    updated_at: string;
}

export interface SpaceSummary {
    name: string;
    description: string;
    tags: string[];
    hidden: boolean;
    memory_count: number;
}

export interface Memory {
    id: number;
    space_name: string;
    name: string;
    content: string;
    tier: Tier;
    pinned: boolean;
    access_count: number;
    last_accessed_at: string | null;
    embedding: Float32Array | null;
    tags: string[];
    created_at: string;
    updated_at: string;
    changed_at: string;
}

export interface MemorySummary {
    id: number;
    space_name: string;
    name: string;
    tier: Tier;
    pinned: boolean;
    tags: string[];
    access_count: number;
    created_at: string;
    updated_at: string;
    changed_at: string;
}

export interface Link {
    source_id: number;
    target_id: number;
    source_name: string;
    source_space: string;
    target_name: string;
    target_space: string;
    label: string;
    created_at: string;
}

export type Tier = 1 | 2 | 3 | 4;

export interface SearchFilter {
    space?: string;
    tag?: string;
    tier?: Tier;
}

export interface SearchResult {
    id: number;
    space_name: string;
    name: string;
    content: string;
    tier: Tier;
    pinned: boolean;
    tags: string[];
    rank: number;
    similarity?: number;
    created_at: string;
    updated_at: string;
    changed_at: string;
}

export interface MemoryQueryFilter {
    space?: string;
    tag?: string;
    tier?: Tier;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
}

export interface StatusResult {
    db_path: string;
    db_size_bytes: number;
    total_spaces: number;
    total_memories: number;
    /** Always contains entries for all 4 tiers, even if count is 0 */
    by_tier: { tier: Tier; count: number; pinned: number }[];
    /** RAG / embeddings info */
    rag_enabled: boolean;
    embeddings_indexed: number;
}

/** Legacy brain.json format for migration */
export interface LegacyBrain {
    [spaceName: string]: {
        description: string;
        memories: { name: string; description: string }[];
    };
}
