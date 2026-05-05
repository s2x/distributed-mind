import { createLibsqlStore } from './libsql-store';
import type { MindStore } from './mind-store';

const MIND_LEGACY_VARS = [
  'MIND_DATA_DIR',
  'MIND_DB_PATH',
  'MIND_RAG',
  'MIND_PORT',
  'MIND_MCP_IDLE_TIMEOUT',
  'MIND_API_IDLE_TIMEOUT',
  'MIND_LOG_RETENTION_MINUTES',
];

function rejectLegacyEnvVars(): void {
  const found = MIND_LEGACY_VARS.filter((v) => process.env[v] !== undefined);
  if (found.length > 0) {
    console.error(`✗ ${found.join(', ')} is set, but dimind only reads DIMIND_* env vars.`);
    console.error(`  Aliases are deliberately not supported (prevents silent config collision).`);
    console.error(
      `  Did you mean: export DIMIND_${found[0].replace('MIND_', '')}=... ?`
    );
    process.exit(1);
  }
}

function getOrComputeClientId(): string {
  if (process.env.DIMIND_CLIENT_ID) return process.env.DIMIND_CLIENT_ID;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os') as typeof import('os');
  return `${os.hostname()}-${process.env.USER ?? 'unknown'}`;
}

export async function createDimindStore(): Promise<MindStore> {
  rejectLegacyEnvVars();

  const dbUrl = process.env.DIMIND_DATABASE_URL;
  const syncUrl = process.env.DIMIND_SYNC_URL;
  const authToken = process.env.DIMIND_SYNC_AUTH_TOKEN;

  // Refuse non-HTTPS unless explicitly allowed
  if (
    syncUrl &&
    !syncUrl.startsWith('https://') &&
    process.env.DIMIND_ALLOW_INSECURE_SYNC !== '1'
  ) {
    console.error(`✗ DIMIND_SYNC_URL must use https:// (got ${syncUrl}).`);
    console.error(`  Set DIMIND_ALLOW_INSECURE_SYNC=1 for local dev only.`);
    process.exit(1);
  }

  // Determine DB URL
  const resolvedUrl = dbUrl ?? `file:./data/dimind.db`;

  return createLibsqlStore({
    url: resolvedUrl,
    syncUrl,
    authToken,
    intMode: 'number',
    clientId: getOrComputeClientId(),
  });
}
