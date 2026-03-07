import { createSqliteStore } from './store/sqlite-store';
import { executeCommand } from './cli/command-executor';
import { useLogger } from './helpers/logger';
import { CONFIG } from './config';
import * as fs from 'fs';

async function main() {
  const args = process.argv.slice(2);
  if (!fs.existsSync(CONFIG.dataDir)) {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  }

  const logger = useLogger();
  const store = createSqliteStore(CONFIG.dbPath);

  try {
    await executeCommand(args, store, logger);
  } catch (e: any) {
    logger.logError(e.message);
    process.exit(1);
  } finally {
    store.close();
  }
}

main();
