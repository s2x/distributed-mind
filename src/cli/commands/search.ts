import { formatMemoryLine } from '../../helpers/format';
import { style } from '../../helpers/style';
import type { Tier } from '../../types';
import { ArgParser } from '../arg-parser';

import type { CommandGroup } from './types';

const p = ArgParser.param.bind(ArgParser);

const SEARCH = new ArgParser(
  ['search|s', p('query')],
  'Full-text search across all memories. Use term* for prefix match.',
  [
    { name: 'space', hasValue: true, description: 'space name (e.g. projects/api)' },
    { name: 'tag', hasValue: true, description: 'tag without # (e.g. backend)' },
    { name: 'tier', hasValue: true, description: '1|2|3' },
    { name: 'detail', hasValue: false, description: 'show content + changed date' },
  ]
);

const QUERY = new ArgParser(['query|q'], 'Query memories by metadata/date with pagination.', [
  { name: 'space', hasValue: true, description: 'space name (e.g. Credentials)' },
  { name: 'tag', hasValue: true, description: 'tag without # (e.g. backend)' },
  { name: 'tier', hasValue: true, description: '1|2|3' },
  { name: 'from', hasValue: true, description: 'YYYY-MM-DD or ISO datetime' },
  { name: 'to', hasValue: true, description: 'YYYY-MM-DD or ISO datetime' },
  { name: 'limit', hasValue: true, description: 'page size (default: 25)' },
  { name: 'offset', hasValue: true, description: 'start index (0, 25, 50, ...)' },
]);

export const searchGroup: CommandGroup = {
  name: 'Search',
  helpEntries: [SEARCH, QUERY],
  commands: [
    {
      matches: args => SEARCH.matches(args),
      execute: async (args, store, logger) => {
        const { query } = SEARCH.getParams(args);
        const flags = SEARCH.getFlags(args);
        const filter = {
          space: flags.space ? String(flags.space) : undefined,
          tag: flags.tag ? String(flags.tag) : undefined,
          tier: flags.tier ? (parseInt(String(flags.tier)) as Tier) : undefined,
        };
        const showDetail = !!flags.detail;

        const results = await store.search(query, filter);
        if (results.length === 0) {
          logger.logInfo('No results found');
          return;
        }

        logger.logInfo(
          style(`🔍 ${results.length} result(s) for "${query}":`, ['bold', 'magenta'])
        );
        for (const r of results) {
          const sim = r.similarity !== undefined ? ` (${(r.similarity * 100).toFixed(1)}%)` : '';
          logger.logInfo(`   ${formatMemoryLine(r, { showSpace: true })}${sim}`);
          if (showDetail) {
            const preview = r.content.length > 120 ? r.content.slice(0, 120) + '...' : r.content;
            if (preview) logger.logInfo(style(`      ${preview}`, ['dim']));
          }
        }
      },
    },
    {
      matches: args => QUERY.matches(args),
      execute: async (args, store, logger) => {
        const flags = QUERY.getFlags(args);
        const tier = flags.tier ? (parseInt(String(flags.tier)) as Tier) : undefined;
        const limit = flags.limit ? parseInt(String(flags.limit), 10) : undefined;
        const offset = flags.offset ? parseInt(String(flags.offset), 10) : undefined;
        const effectiveLimit = limit ?? 25;
        const effectiveOffset = offset ?? 0;

        if (tier !== undefined && (tier < 1 || tier > 3)) {
          throw new Error('--tier must be between 1 and 3.');
        }
        if (limit !== undefined && Number.isNaN(limit)) {
          throw new Error('--limit must be a valid number.');
        }
        if (offset !== undefined && Number.isNaN(offset)) {
          throw new Error('--offset must be a valid number.');
        }

        const results = await store.queryMemories({
          space: flags.space ? String(flags.space) : undefined,
          tag: flags.tag ? String(flags.tag) : undefined,
          tier,
          from: flags.from ? String(flags.from) : undefined,
          to: flags.to ? String(flags.to) : undefined,
          limit: effectiveLimit,
          offset: effectiveOffset,
        });

        if (results.length === 0) {
          logger.logInfo('No memories found');
          return;
        }

        logger.logInfo(style(`🧾 ${results.length} memory result(s):`, ['bold', 'magenta']));
        for (const r of results) {
          logger.logInfo(`   ${formatMemoryLine(r, { showSpace: true })}`);
        }

        const nextOffset =
          results.length === effectiveLimit ? String(effectiveOffset + effectiveLimit) : 'N/A';
        logger.logInfo(
          style(
            `Pagination | limit: ${effectiveLimit} | offset: ${effectiveOffset} | next offset: ${nextOffset}`,
            ['dim']
          )
        );
      },
    },
  ],
};
