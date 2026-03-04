import { createSqliteStore } from './store/sqlite-store';
import { executeCommand } from './command-executor';
import { useLogger } from './logger';
import { CONFIG } from './config';
import * as fs from 'fs';

// Ensure data directory exists
if (!fs.existsSync(CONFIG.dataDir)) {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
}

const logger = useLogger();
const store = createSqliteStore(CONFIG.dbPath);

try {
    const args = process.argv.slice(2);
    executeCommand(args, store, logger);
} catch (e: any) {
    logger.logError(e.message);
    process.exit(1);
} finally {
    store.close();
}
