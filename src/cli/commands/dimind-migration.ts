// ── dimind export/import commands ──
// export: dump all data as SQL INSERT statements (portability format).
// import: load from a SQL dump (dimind export) or a legacy mind.db (bun:sqlite).

import { style } from '../../helpers/style';
import { ArgParser } from '../arg-parser';

import type { CommandGroup } from './types';

const EXPORT = new ArgParser(
  ['export'],
  'Export all spaces, memories, tags, and links as a SQL dump',
  [{ name: 'format', hasValue: true, description: 'Output format: sql (default)' }]
);

const IMPORT = new ArgParser(
  ['import'],
  'Import from a SQL dump (dimind export) or a legacy mind.db file',
  [
    { name: 'from', hasValue: true, description: 'Path to SQL dump or mind.db file (required)' },
    {
      name: 'as-persistence',
      hasValue: true,
      description: 'Persistence level for imported memories: soft | hard (default: soft)',
    },
  ]
);

export const dimindMigrationGroup: CommandGroup = {
  name: 'Export/Import',
  helpEntries: [EXPORT, IMPORT],
  commands: [
    // export --format sql
    {
      matches: args => EXPORT.matches(args),
      execute: async (args, store, _logger) => {
        const flags = EXPORT.getFlags(args);
        const format = flags.format ? String(flags.format) : 'sql';
        if (format !== 'sql') {
          throw new Error(`Unsupported format: "${format}". Only "sql" is supported.`);
        }
        if (!store.exportToSql) {
          throw new Error('export is only available on the dimind (libSQL) backend.');
        }
        const sql = await store.exportToSql();
        // Write directly to stdout — callers can redirect to a file
        process.stdout.write(sql);
      },
    },

    // import --from <file> [--as-persistence soft|hard]
    {
      matches: args => IMPORT.matches(args),
      execute: async (args, store, logger) => {
        const flags = IMPORT.getFlags(args);
        const filePath = flags['from'] ? String(flags['from']) : undefined;
        if (!filePath) {
          throw new Error('--from <file> is required. Example: dimind import --from export.sql');
        }
        if (!store.importFromFile) {
          throw new Error('import is only available on the dimind (libSQL) backend.');
        }

        const rawPersistence = flags['as-persistence'];
        if (
          rawPersistence !== undefined &&
          rawPersistence !== 'soft' &&
          rawPersistence !== 'hard'
        ) {
          throw new Error(
            `--as-persistence must be "soft" or "hard" (got "${rawPersistence}").`
          );
        }
        const asPersistence = (rawPersistence as 'soft' | 'hard' | undefined) ?? 'soft';

        logger.logInfo(style(`Importing from ${filePath} (persistence=${asPersistence})…`, ['dim']));
        const result = await store.importFromFile(filePath, { asPersistence });

        logger.logInfo(
          style('✅ Import complete', ['bold', 'green']) +
            `   ${result.imported} memory(ies) inserted`
        );

        if (result.errors.length > 0) {
          logger.logInfo(style(`⚠️  ${result.errors.length} error(s):`, ['bold', 'yellow']));
          for (const err of result.errors) {
            logger.logError(`  ${err}`);
          }
        }
      },
    },
  ],
};
