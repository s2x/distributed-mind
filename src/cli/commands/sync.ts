import type { Logger } from '../../helpers/logger';
import { style } from '../../helpers/style';
import type { MindStore } from '../../store/mind-store';
import { ArgParser } from '../arg-parser';

import type { CommandGroup } from './types';

const SYNC = new ArgParser(['sync'], 'Sync with team primary (push + pull)', [
  { name: 'pull', hasValue: false, description: 'pull only' },
  { name: 'push', hasValue: false, description: 'push only' },
  { name: 'status', hasValue: false, description: 'show sync status' },
]);

async function renderSyncStatus(store: MindStore, logger: Logger): Promise<void> {
  const syncAvailable = !!store.sync;

  logger.logInfo(style('🔄 Sync Status', ['bold', 'magenta']));
  logger.logInfo('');

  if (!syncAvailable) {
    logger.logInfo('   Sync mode: NOT AVAILABLE');
    logger.logInfo('');
    logger.logInfo('   Sync is only available in team mode.');
    logger.logInfo('   Set DIMIND_SYNC_URL to enable.');
    return;
  }

  logger.logInfo('   Sync mode: TEAM (available)');
  const syncUrl = process.env.DIMIND_SYNC_URL ?? '(not configured)';
  logger.logInfo(`   Primary:   ${syncUrl}`);
  logger.logInfo('');
  logger.logInfo('   Use: dimind sync          (pull latest changes)');
  logger.logInfo('        dimind sync --pull   (pull only)');
  logger.logInfo('        dimind sync --push   (push only — auto on hard writes)');
}

export const syncGroup: CommandGroup = {
  name: 'Sync',
  helpEntries: [SYNC],
  commands: [
    {
      matches: args => SYNC.matches(args),
      execute: async (args, store, logger) => {
        if (!store.sync) {
          logger.logError('sync is only available in team mode (dimind with DIMIND_SYNC_URL)');
          return;
        }

        const flags = SYNC.getFlags(args);

        if (flags.status) {
          await renderSyncStatus(store, logger);
          return;
        }

        if (flags.push) {
          logger.logInfo('Hard writes are synchronous — nothing to push manually.');
          return;
        }

        // --pull or default
        logger.logInfo(style('🔄 Syncing with primary...', ['dim']));
        await store.sync();
        logger.logInfo(style('✓ Synced with primary', ['green']));
      },
    },
  ],
};
