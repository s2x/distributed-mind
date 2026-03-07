import { style } from 'bun-style';
import type { Logger } from '../helpers/logger';
import type { MindStore } from '../store/mind-store';
import { ALL_GROUPS, SERVER_GROUP_HELP } from './commands';
import { renderCommands } from '../helpers/format';

const HELP_ALIASES = new Set(['help', 'h']);

export async function executeCommand(args: string[], store: MindStore, logger: Logger): Promise<void> {
  if (args.length === 0) {
    throw new Error('No arguments provided. Run mind help for usage.');
  }

  if (HELP_ALIASES.has(args[0]!)) {
    printHelp(logger);
    return;
  }

  for (const group of ALL_GROUPS) {
    for (const command of group.commands) {
      if (command.matches(args)) {
        await command.execute(args, store, logger);
        return;
      }
    }
  }

  throw new Error(`Unknown command "${args[0]}". Run mind help for the list of valid commands.`);
}

function printHelp(logger: Logger): void {
  logger.logInfo(style('🧠 mind — long-term memory for agents and humans', ['bold']));

  const sections = ['Spaces', 'Memories', 'Tiers', 'Links', 'Search', 'Status', 'Tags', 'Checkpoint'];
  for (const name of sections) {
    const group = ALL_GROUPS.find((g) => g.name === name);
    if (!group) continue;
    logger.logInfo('');
    logger.logInfo(style(`${group.name}:`, ['bold', 'magenta']));
    renderCommands(group.helpEntries, logger);
  }

  logger.logInfo('');
  logger.logInfo(style('Server:', ['bold', 'magenta']));
  renderCommands(SERVER_GROUP_HELP, logger);

  logger.logInfo('');
  logger.logInfo(style('Other:', ['bold', 'magenta']));
  const guide = ALL_GROUPS.find((g) => g.name === 'Guide');
  const migration = ALL_GROUPS.find((g) => g.name === 'Migration');
  renderCommands([...(guide?.helpEntries ?? []), ...(migration?.helpEntries ?? [])], logger);
}
