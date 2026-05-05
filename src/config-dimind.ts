function getDefaultDbUrl(): string {
  if (process.env.DIMIND_DATABASE_URL) return process.env.DIMIND_DATABASE_URL;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  const xdgData = process.env.XDG_DATA_HOME ?? `${home}/.local/share`;
  return `file:${xdgData}/dimind/dimind.db`;
}

export const DIMIND_CONFIG = {
  dbUrl: getDefaultDbUrl(),
  syncUrl: process.env.DIMIND_SYNC_URL,
  syncAuthToken: process.env.DIMIND_SYNC_AUTH_TOKEN,
  allowInsecureSync: process.env.DIMIND_ALLOW_INSECURE_SYNC === '1',
  noLegacyWarning: process.env.DIMIND_NO_LEGACY_WARNING === '1',
  clientId: process.env.DIMIND_CLIENT_ID,
};
