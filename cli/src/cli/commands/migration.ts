import * as fs from 'fs';

import { CONFIG } from '../../config';
import { style } from '../../helpers/style';
import { ArgParser } from '../arg-parser';

import type { CommandGroup } from './types';

const IMPORT = new ArgParser(['import'], 'Imports data from legacy brain.json');

export const migrationGroup: CommandGroup = {
  name: 'Migration',
  helpEntries: [IMPORT],
  commands: [
    {
      matches: args => IMPORT.matches(args),
      execute: async (_args, store, logger) => {
        if (!fs.existsSync(CONFIG.legacyJsonPath)) {
          throw new Error(`No legacy brain.json found at ${CONFIG.legacyJsonPath}`);
        }

        const raw = fs.readFileSync(CONFIG.legacyJsonPath, 'utf8');
        const brain = JSON.parse(raw);
        store.importFromJson(brain);
        logger.logInfo(style('✅ Import complete', ['bold', 'green']));

        const spaces = Object.keys(brain);
        const memories = spaces.reduce(
          (acc: number, s: string) => acc + (brain[s].memories?.length ?? 0),
          0
        );
        logger.logInfo(`   ${spaces.length} space(s), ${memories} memory(ies) imported`);
      },
    },
  ],
};
