import { parseMemoryRef } from '../../helpers/format';
import { style } from '../../helpers/style';
import { ArgParser } from '../arg-parser';

import type { CommandGroup } from './types';

const p = ArgParser.param.bind(ArgParser);

const LINK = new ArgParser(
  ['link', p('source'), p('target')],
  'Links two memories (format: space/name)',
  [{ name: 'label', alias: 'l', hasValue: true }]
);
const UNLINK = new ArgParser(
  ['unlink', p('source'), p('target')],
  'Removes a link between two memories'
);
const LINKS = new ArgParser(['links', p('space'), p('name')], 'Shows all links for a memory');

export const linksGroup: CommandGroup = {
  name: 'Links',
  helpEntries: [LINK, UNLINK, LINKS],
  commands: [
    {
      matches: args => LINK.matches(args),
      execute: async (args, store, logger) => {
        const { source, target } = LINK.getParams(args);
        const flags = LINK.getFlags(args);
        const label = flags.label ? String(flags.label) : undefined;

        const src = parseMemoryRef(source);
        const tgt = parseMemoryRef(target);

        const srcMem = await store.getMemory(src.space, src.name);
        if (!srcMem) throw new Error(`Memory "${src.name}" not found in space "${src.space}"`);
        const tgtMem = await store.getMemory(tgt.space, tgt.name);
        if (!tgtMem) throw new Error(`Memory "${tgt.name}" not found in space "${tgt.space}"`);

        await store.link(srcMem.id, tgtMem.id, label);
        logger.logInfo(
          style(`🔗 Linked: ${source} → ${target}` + (label ? ` [${label}]` : ''), [
            'bold',
            'green',
          ])
        );
      },
    },
    {
      matches: args => UNLINK.matches(args),
      execute: async (args, store, logger) => {
        const { source, target } = UNLINK.getParams(args);
        const src = parseMemoryRef(source);
        const tgt = parseMemoryRef(target);

        const srcMem = await store.getMemory(src.space, src.name);
        if (!srcMem) throw new Error(`Memory "${src.name}" not found in space "${src.space}"`);
        const tgtMem = await store.getMemory(tgt.space, tgt.name);
        if (!tgtMem) throw new Error(`Memory "${tgt.name}" not found in space "${tgt.space}"`);

        await store.unlink(srcMem.id, tgtMem.id);
        logger.logInfo(style(`🔗 Unlinked: ${source} ✕ ${target}`, ['bold', 'green']));
      },
    },
    {
      matches: args => LINKS.matches(args),
      execute: async (args, store, logger) => {
        const { space, name } = LINKS.getParams(args);
        const memory = await store.getMemory(space, name);
        if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);

        const links = await store.getLinks(memory.id);
        if (links.length === 0) {
          logger.logInfo('No links found');
          return;
        }

        logger.logInfo(style(`🔗 Links for ${space}/${name}:`, ['bold', 'blue']));
        for (const link of links) {
          const isSource = link.source_id === memory.id;
          const other = isSource
            ? `${link.target_space}/${link.target_name}`
            : `${link.source_space}/${link.source_name}`;
          const direction = isSource ? '→' : '←';
          logger.logInfo(
            `   ${direction} ${style(other, ['bold'])} [${style(link.label, ['cyan'])}]`
          );
        }
      },
    },
  ],
};
