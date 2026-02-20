import * as path from 'path';

const repoRoot = path.join(import.meta.dir, '..', '..');
const dataDir = process.env.BRAIN_DATA_DIR ?? 'data';
const storagePath = path.isAbsolute(dataDir)
    ? path.join(dataDir, 'brain.json')
    : path.join(repoRoot, dataDir, 'brain.json');

export const CONFIG = {
    storagePath,
};
