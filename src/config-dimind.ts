import { join } from 'path';

const PROJECT_ROOT = import.meta.dir.includes('.worktrees')
  ? join(import.meta.dir, '..', '..') // worktree
  : join(import.meta.dir, '..'); // normal

export const DIMIND_CONFIG = {
  dataDir: process.env.DIMIND_DATA_DIR ?? join(PROJECT_ROOT, 'data'),
  dbPath:
    process.env.DIMIND_DATABASE_URL ??
    `file:${join(process.env.DIMIND_DATA_DIR ?? join(PROJECT_ROOT, 'data'), 'dimind.db')}`,
  syncUrl: process.env.DIMIND_SYNC_URL,
  syncAuthToken: process.env.DIMIND_SYNC_AUTH_TOKEN,
  allowInsecureSync: process.env.DIMIND_ALLOW_INSECURE_SYNC === '1',
  noLegacyWarning: process.env.DIMIND_NO_LEGACY_WARNING === '1',
  clientId: process.env.DIMIND_CLIENT_ID,
};
