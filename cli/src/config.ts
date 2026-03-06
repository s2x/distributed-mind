import * as path from 'path';

const repoRoot = path.join(import.meta.dir, '..', '..');
const dataDir = process.env.MIND_DATA_DIR ?? 'data';

const resolvedDataDir = path.isAbsolute(dataDir) ? dataDir : path.join(repoRoot, dataDir);

/**
 * MIND_DB_PATH overrides the full database file path (useful for testing with a temp DB).
 * Falls back to MIND_DATA_DIR/mind.db.
 */
const dbPath = process.env.MIND_DB_PATH ?? path.join(resolvedDataDir, 'mind.db');

export const CONFIG = {
    dataDir: resolvedDataDir,
    dbPath,
    /** Legacy JSON path for migration */
    legacyJsonPath: path.join(resolvedDataDir, 'brain.json'),
    /** RAG: Enable semantic search with OpenAI embeddings */
    rag: {
        enabled: process.env.MIND_RAG === 'true',
        apiKey: process.env.OPENAI_API_KEY ?? null,
        model: 'text-embedding-3-small',
    },
};

/**
 * Max non-pinned memories per space per tier.
 * T4 is unlimited (not included here).
 */
export const TIER_LIMITS: Record<1 | 2 | 3, number> = {
    1: 25,
    2: 50,
    3: 100,
};
