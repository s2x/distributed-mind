// ── Core domain types for Mind v2 ──

export interface Space {
    name: string;
    description: string;
    tags: string[];
    created_at: string;
    updated_at: string;
}

export interface SpaceSummary {
    name: string;
    description: string;
    tags: string[];
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
    tags: string[];
    created_at: string;
    updated_at: string;
}

export interface MemorySummary {
    id: number;
    name: string;
    tier: Tier;
    pinned: boolean;
    tags: string[];
    access_count: number;
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

export type Tier = 1 | 2 | 3;

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
}

export interface TidyResult {
    demoted: { id: number; name: string; space: string; from_tier: Tier; to_tier: Tier }[];
    candidates_for_gc: { id: number; name: string; space: string; last_accessed_at: string | null }[];
}

export interface GcResult {
    removed: { id: number; name: string; space: string }[];
}

export interface Stats {
    total_spaces: number;
    total_memories: number;
    by_tier: { tier: Tier; count: number }[];
    most_accessed: { id: number; name: string; space: string; access_count: number }[];
    least_accessed: { id: number; name: string; space: string; last_accessed_at: string | null }[];
}

/** Legacy brain.json format for migration */
export interface LegacyBrain {
    [spaceName: string]: {
        description: string;
        memories: { name: string; description: string }[];
    };
}
