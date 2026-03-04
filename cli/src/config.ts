import * as path from 'path';

const repoRoot = path.join(import.meta.dir, '..', '..');
const dataDir = process.env.MIND_DATA_DIR ?? 'data';

const resolvedDataDir = path.isAbsolute(dataDir) ? dataDir : path.join(repoRoot, dataDir);

export const CONFIG = {
    dataDir: resolvedDataDir,
    dbPath: path.join(resolvedDataDir, 'mind.db'),
    /** Legacy JSON path for migration */
    legacyJsonPath: path.join(resolvedDataDir, 'brain.json'),
};
