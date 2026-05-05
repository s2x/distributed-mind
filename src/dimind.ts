import { executeCommand } from './cli/command-executor';
import { useLogger } from './helpers/logger';
import { createDimindStore } from './store/factory';

async function main() {
  const store = await createDimindStore();
  const logger = useLogger();
  const args = process.argv.slice(2);

  // Run log cleanup on startup and every hour (fire-and-forget)
  const runLogCleanup = () => {
    store
      .cleanupOldLogs(360)
      .then((deleted) => {
        if (deleted > 0) {
          logger.logInfo(`Cleaned up ${deleted} old log entries`);
        }
      })
      .catch(() => {
        // Non-blocking: don't fail startup if cleanup fails
      });
  };
  runLogCleanup();
  const cleanupInterval = setInterval(runLogCleanup, 60 * 60 * 1000); // Every hour

  try {
    await executeCommand(args, store, logger);
    process.exit(0);
  } catch (e: unknown) {
    logger.logError(e instanceof Error ? e.message : String(e));
    process.exit(1);
  } finally {
    clearInterval(cleanupInterval);
    store.close();
  }
}

await main();
