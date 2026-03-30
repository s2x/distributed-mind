import { ArgParser } from '../arg-parser';
import { style } from '../../helpers/style';
import { tierLabel } from '../../helpers/format';
import type { CommandGroup } from './types';
import type { Tier } from '../../types';

const p = ArgParser.param.bind(ArgParser);

const PROMOTE = new ArgParser(
    ['promote|up', p('space'), p('name')],
    'Promotes a memory one tier up (T3→T2, T2→T1)'
);
const DEMOTE = new ArgParser(
    ['demote|down', p('space'), p('name')],
    'Demotes a memory one tier down (T1→T2, T2→T3)'
);
const PIN = new ArgParser(['pin', p('space'), p('name')], 'Pins a memory (immune to auto-promotion)');
const UNPIN = new ArgParser(['unpin', p('space'), p('name')], 'Unpins a memory');

export const tiersGroup: CommandGroup = {
    name: 'Tiers',
    helpEntries: [PROMOTE, DEMOTE, PIN, UNPIN],
    commands: [
        {
            matches: (args) => PROMOTE.matches(args),
            execute: async (args, store, logger) => {
                const { space, name } = PROMOTE.getParams(args);
                const memory = store.getMemory(space, name);
                if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
                store.promote(memory.id);
                const newTier = (memory.tier - 1) as Tier;
                logger.logInfo(style(`✅ "${name}" promoted to ${tierLabel(newTier)}`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => DEMOTE.matches(args),
            execute: async (args, store, logger) => {
                const { space, name } = DEMOTE.getParams(args);
                const memory = store.getMemory(space, name);
                if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
                store.demote(memory.id);
                const newTier = (memory.tier + 1) as Tier;
                logger.logInfo(style(`✅ "${name}" demoted to ${tierLabel(newTier)}`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => PIN.matches(args),
            execute: async (args, store, logger) => {
                const { space, name } = PIN.getParams(args);
                const memory = store.getMemory(space, name);
                if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
                store.pin(memory.id);
                logger.logInfo(style(`📌 "${name}" pinned at ${tierLabel(memory.tier)}`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => UNPIN.matches(args),
            execute: async (args, store, logger) => {
                const { space, name } = UNPIN.getParams(args);
                const memory = store.getMemory(space, name);
                if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
                store.unpin(memory.id);
                logger.logInfo(style(`📌 "${name}" unpinned`, ['bold', 'green']));
            },
        },
    ],
};
