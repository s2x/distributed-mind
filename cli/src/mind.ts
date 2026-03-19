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

    // Run log cleanup on startup and every hour (fire-and-forget)
    const runLogCleanup = () => {
        try {
            const deleted = store.cleanupOldLogs(CONFIG.logRetentionMinutes);
            if (deleted > 0) {
                logger.logInfo(`Cleaned up ${deleted} old log entries`);
            }
        } catch (e) {
            // Non-blocking: don't fail startup if cleanup fails
        }
    };
    runLogCleanup();
    const cleanupInterval = setInterval(runLogCleanup, 60 * 60 * 1000); // Every hour

    try {
        await executeCommand(args, store, logger);
        process.exit(0);
    } catch (e: any) {
        logger.logError(e.message);
        process.exit(1);
    } finally {
        clearInterval(cleanupInterval);
        store.close();
    }
}

main();
