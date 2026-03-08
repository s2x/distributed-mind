import { ArgParser } from '../arg-parser';
import { style } from '../../helpers/style';
import type { CommandGroup } from './types';
import type { Logger } from '../../helpers/logger';

const p = ArgParser.param.bind(ArgParser);

const GUIDE = new ArgParser(['guide|g'], 'Shows usage guide');
const GUIDE_MODE = new ArgParser(['guide|g', p('mode')], 'Shows usage guide (agent or human)');

function printGuide(logger: Logger, mode: string): void {
    if (mode === 'agent') {
        logger.logInfo(style('🤖 mind — Agent Guide', ['bold', 'magenta']));
        logger.logInfo('');
        logger.logInfo('mind is a persistent long-term memory system. Data is organized in spaces,');
        logger.logInfo('each containing memories. Run mind help for the full command reference.');
        logger.logInfo('');
        logger.logInfo(style('Data model:', ['bold']));
        logger.logInfo('  Space    Namespace with a name, description, and tags.');
        logger.logInfo('  Memory   Key-value entry: name, content, tier (1–4), tags.');
        logger.logInfo('  Tier     🔴 T1 hot (25/space) → 🟡 T2 warm (50/space, default)');
        logger.logInfo('           → 🔵 T3 cold (100/space) → 💠 T4 frozen (unlimited).');
        logger.logInfo('           Reading a non-pinned memory auto-promotes it one tier up.');
        logger.logInfo('           T4 entries are only reachable via search, not list.');
        logger.logInfo('  Pin      Pinned memories are never auto-promoted or LRU-evicted.');
        logger.logInfo('  Link     Directional edge between two memories with a label.');
        logger.logInfo('');
        logger.logInfo(style('Best practices:', ['bold']));
        logger.logInfo('  - Search before adding to avoid duplicates (search covers T4 too)');
        logger.logInfo('  - Pin critical memories to prevent auto-promotion and LRU eviction');
        logger.logInfo('  - T4 memories are frozen but still searchable');
        logger.logInfo('  - Run mind help for the full command reference');
    } else {
        logger.logInfo(style('🧠 mind — User Guide', ['bold', 'magenta']));
        logger.logInfo('');
        logger.logInfo('mind is a CLI tool for tracking thoughts, ideas, and knowledge.');
        logger.logInfo('Data is organized in spaces, each containing memories with tiers.');
        logger.logInfo('');
        logger.logInfo(style('Tiers (CPU-cache style):', ['bold']));
        logger.logInfo('  🔴 T1 hot    (25/space)  — Frequently accessed');
        logger.logInfo('  🟡 T2 warm   (50/space)  — Default for new memories');
        logger.logInfo('  🔵 T3 cold   (100/space) — Rarely used');
        logger.logInfo('  💠 T4 frozen (unlimited) — Archive; only reachable via search');
        logger.logInfo('  Reading a memory auto-promotes it one tier up.');
        logger.logInfo('');
        logger.logInfo('Run mind help for the full command reference.');
    }
}

export const guideGroup: CommandGroup = {
    name: 'Guide',
    helpEntries: [GUIDE, GUIDE_MODE],
    commands: [
        {
            matches: (args) => GUIDE_MODE.matches(args),
            execute: async (args, _store, logger) => {
                const { mode } = GUIDE_MODE.getParams(args);
                printGuide(logger, mode);
            },
        },
        {
            matches: (args) => GUIDE.matches(args),
            execute: async (_args, _store, logger) => {
                printGuide(logger, 'human');
            },
        },
    ],
};
