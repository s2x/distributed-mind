import { style } from '../../helpers/style';
import { ArgParser } from '../arg-parser';

import type { CommandGroup } from './types';

const LIST_TAGS = new ArgParser(['tags|tgs'], 'Lists all tags in the system', [
  { name: 'spaces', hasValue: false, description: 'show only space tags' },
  { name: 'memories', hasValue: false, description: 'show only memory tags' },
]);

export const tagsGroup: CommandGroup = {
  name: 'Tags',
  helpEntries: [LIST_TAGS],
  commands: [
    {
      matches: args => LIST_TAGS.matches(args),
      execute: async (args, store, logger) => {
        const flags = LIST_TAGS.getFlags(args);
        const showSpaces =
          flags.spaces !== undefined ||
          (flags.spaces === undefined && flags.memories === undefined);
        const showMemories =
          flags.memories !== undefined ||
          (flags.spaces === undefined && flags.memories === undefined);
        const tags = store.listAllTags();

        if (tags.spaces.length === 0 && tags.memories.length === 0) {
          logger.logInfo('No tags found');
          return;
        }

        if (showSpaces && tags.spaces.length > 0) {
          logger.logInfo(style('🏷️  Space Tags:', ['bold', 'magenta']));
          const tagStr = tags.spaces
            .map(t => style(`#${t.tag}`, ['cyan']) + style(` (${t.count})`, ['dim']))
            .join(' ');
          logger.logInfo(`   ${tagStr}`);
          logger.logInfo('');
        }

        if (showMemories && tags.memories.length > 0) {
          logger.logInfo(style('🏷️  Memory Tags:', ['bold', 'magenta']));
          const tagStr = tags.memories
            .map(t => style(`#${t.tag}`, ['cyan']) + style(` (${t.count})`, ['dim']))
            .join(' ');
          logger.logInfo(`   ${tagStr}`);
        }
      },
    },
  ],
};
