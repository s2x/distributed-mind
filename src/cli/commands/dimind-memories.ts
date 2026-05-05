// ── dimind-specific memory commands ──
// These commands extend the standard memories group with persistence-aware behavior:
//   - `add` defaults to persistence='hard' (user at terminal = explicit intent)
//   - `memory promote-to-hard` / `memory demote-to-soft` toggle persistence
//   - `history` shows version history from the memory_versions audit table

import { tierLabel, formatChangedLine } from '../../helpers/format';
import { style } from '../../helpers/style';
import type { Tier } from '../../types';
import { ArgParser } from '../arg-parser';

import type { CommandGroup } from './types';

const p = ArgParser.param.bind(ArgParser);

const ADD_HARD = new ArgParser(
  ['add|a', p('space'), p('name'), p('content')],
  'Adds a memory (defaults to hard persistence; use --soft for ephemeral)',
  [
    { name: 'tags', alias: 't', hasValue: true },
    { name: 'tier', hasValue: true },
    { name: 'soft', hasValue: false },
  ]
);

const PROMOTE_TO_HARD = new ArgParser(
  ['memory', 'promote-to-hard', p('space'), p('name')],
  'Marks a memory as hard-persistent (exempt from LRU eviction)'
);

const DEMOTE_TO_SOFT = new ArgParser(
  ['memory', 'demote-to-soft', p('space'), p('name')],
  'Marks a memory as soft-persistent (subject to LRU eviction)'
);

const HISTORY = new ArgParser(
  ['history', p('space'), p('name')],
  'Shows the version history of a memory from the audit trail'
);

export const dimindMemoriesGroup: CommandGroup = {
  name: 'Persistence',
  helpEntries: [ADD_HARD, PROMOTE_TO_HARD, DEMOTE_TO_SOFT, HISTORY],
  commands: [
    // Override add: defaults to hard persistence
    {
      matches: args => ADD_HARD.matches(args),
      execute: async (args, store, logger) => {
        const { space, name, content } = ADD_HARD.getParams(args);
        const flags = ADD_HARD.getFlags(args);
        const tags = flags.tags
          ? String(flags.tags)
              .split(',')
              .map(t => t.trim())
          : ['untagged'];
        const tier = flags.tier ? (parseInt(String(flags.tier)) as Tier) : undefined;
        if (tier !== undefined && (tier < 1 || tier > 3)) {
          throw new Error('--tier must be 1, 2, or 3 when adding a memory.');
        }
        // Default to 'hard' — user at terminal is explicit.
        // --soft flag to opt out (e.g. for throwaway notes).
        const persistence: 'soft' | 'hard' = flags.soft ? 'soft' : 'hard';
        const memory = await store.addMemory(space, name, content, { tags, tier, persistence });
        const persistLabel = persistence === 'hard' ? ' 🔒hard' : ' 📝soft';
        logger.logInfo(
          style('✅ Memory added: ', ['bold', 'green']) +
            `${style(memory.name, ['bold'])} in ${style(space, ['magenta'])} [${tierLabel(memory.tier)}]${persistLabel}`
        );
      },
    },

    // memory promote-to-hard <space> <name>
    {
      matches: args => PROMOTE_TO_HARD.matches(args),
      execute: async (args, store, logger) => {
        const { space, name } = PROMOTE_TO_HARD.getParams(args);
        await store.promoteToHard(space, name);
        logger.logInfo(
          style(`🔒 "${name}" promoted to hard persistence`, ['bold', 'green']) +
            ` in ${style(space, ['magenta'])}`
        );
      },
    },

    // memory demote-to-soft <space> <name>
    {
      matches: args => DEMOTE_TO_SOFT.matches(args),
      execute: async (args, store, logger) => {
        const { space, name } = DEMOTE_TO_SOFT.getParams(args);
        await store.demoteToSoft(space, name);
        logger.logInfo(
          style(`📝 "${name}" demoted to soft persistence`, ['bold', 'yellow']) +
            ` in ${style(space, ['magenta'])}`
        );
      },
    },

    // history <space> <name>
    {
      matches: args => HISTORY.matches(args),
      execute: async (args, store, logger) => {
        const { space, name } = HISTORY.getParams(args);
        if (!store.getMemoryHistory) {
          throw new Error('history command is only available on the dimind (libSQL) backend.');
        }
        const versions = await store.getMemoryHistory(space, name);
        if (versions.length === 0) {
          logger.logInfo(
            `No version history found for "${name}" in ${style(space, ['magenta'])}.`
          );
          return;
        }
        logger.logInfo(
          style(`📜 Version history: ${space} › ${name}`, ['bold', 'blue']) +
            ` (${versions.length} version${versions.length === 1 ? '' : 's'})`
        );
        for (const v of versions) {
          const who = v.changedBy ? ` by ${v.changedBy}` : '';
          const client = v.clientId ? ` [${v.clientId}]` : '';
          const opLabel = style(`v${v.versionNumber} ${v.operation}`, ['bold']);
          const ts = style(formatChangedLine(v.changedAt), ['dim']);
          logger.logInfo(`  ${opLabel}${who}${client}  ${ts}`);
          // Show first 80 chars of content as preview
          const preview = v.content.length > 80 ? v.content.slice(0, 77) + '...' : v.content;
          logger.logInfo(style(`    ${preview}`, ['dim']));
        }
      },
    },
  ],
};
