import { ArgParser } from '../arg-parser';
import { style } from 'bun-style';
import { normalizeTag } from '../../helpers/tags';
import { tierLabel, formatTags, formatChangedLine, formatMemoryLine } from '../../helpers/format';
import type { CommandGroup } from './types';
import type { Tier } from '../../types';

const p = ArgParser.param.bind(ArgParser);

const LIST = new ArgParser(
    ['list|ls|l', p('space')],
    'Lists T1+T2 memories of a space (--tier 3 for cold)',
    [
        { name: 'tier', hasValue: true },
        { name: 'tag', alias: 't', hasValue: true },
    ]
);
const ADD = new ArgParser(
    ['add|a', p('space'), p('name'), p('content')],
    'Adds a memory to a space',
    [
        { name: 'tags', alias: 't', hasValue: true },
        { name: 'tier', hasValue: true },
    ]
);
const READ = new ArgParser(['read|r', p('space'), p('name')], 'Reads a memory (bumps access + auto-promotes)');
const EDIT = new ArgParser(['edit|e', p('space'), p('name'), p('content')], 'Edits a memory content');
const REMOVE = new ArgParser(['remove|rm', p('space'), p('name')], 'Removes a memory by name');
const TAG_MEMORY = new ArgParser(['tag|t', p('space'), p('name'), p('tag')], 'Tags a memory');
const UNTAG_MEMORY = new ArgParser(['untag', p('space'), p('name'), p('tag')], 'Removes a tag from a memory');

export const memoriesGroup: CommandGroup = {
    name: 'Memories',
    helpEntries: [ADD, READ, EDIT, REMOVE, LIST, TAG_MEMORY, UNTAG_MEMORY],
    commands: [
        {
            matches: (args) => LIST.matches(args),
            execute: async (args, store, logger) => {
                const { space } = LIST.getParams(args);
                const flags = LIST.getFlags(args);
                const tier = flags.tier ? (parseInt(String(flags.tier)) as Tier) : undefined;
                const tag = flags.tag ? String(flags.tag) : undefined;
                const memories = store.listMemories(space, { tier, tag });

                const scopeLabel = tier ? ` [${tierLabel(tier)}]` : ' [T1+T2]';

                if (memories.length === 0) {
                    logger.logInfo(`No memories found in ${style(space, ['magenta'])}${scopeLabel}`);
                    return;
                }

                logger.logInfo(style(`📋 ${space}${scopeLabel}:`, ['bold', 'magenta']));

                for (const m of memories) {
                    logger.logInfo(`   ${formatMemoryLine(m, { showSpace: true })}`);
                }
            },
        },
        {
            matches: (args) => ADD.matches(args),
            execute: async (args, store, logger) => {
                const { space, name, content } = ADD.getParams(args);
                const flags = ADD.getFlags(args);
                const tags = flags.tags ? String(flags.tags).split(',').map((t) => t.trim()) : undefined;
                const tier = flags.tier ? (parseInt(String(flags.tier)) as Tier) : undefined;
                if (tier !== undefined && (tier < 1 || tier > 3)) {
                    throw new Error('--tier must be 1, 2, or 3 when adding a memory. T4 is reserved for auto-eviction.');
                }
                const memory = await store.addMemory(space, name, content, { tags, tier });
                logger.logInfo(
                    style('✅ Memory added: ', ['bold', 'green']) +
                        `${style(memory.name, ['bold'])} in ${style(space, ['magenta'])} [${tierLabel(memory.tier)}]`
                );
            },
        },
        {
            matches: (args) => READ.matches(args),
            execute: async (args, store, logger) => {
                const { space, name } = READ.getParams(args);
                const beforeRead = store.getMemory(space, name);
                if (!beforeRead) throw new Error(`Memory "${name}" not found in space "${space}"`);

                store.recordAccess(beforeRead.id);
                const memory = store.getMemoryById(beforeRead.id);
                if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);

                const pin = memory.pinned ? ' 📌' : '';
                const tags = formatTags(memory.tags);
                logger.logInfo(style(`🛸 ${space} › ${memory.name}`, ['bold', 'blue']) + ` [${tierLabel(memory.tier)}]${pin}`);
                if (tags) logger.logInfo(`   ${tags}`);
                logger.logInfo(style(`   ${formatChangedLine(memory.changed_at)}`, ['dim']));
                logger.logInfo(style(memory.content || '(no content)', ['dim']));
            },
        },
        {
            matches: (args) => EDIT.matches(args),
            execute: async (args, store, logger) => {
                const { space, name, content } = EDIT.getParams(args);
                const memory = store.getMemory(space, name);
                if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
                await store.updateMemory(memory.id, { content });
                logger.logInfo(style(`✅ Memory "${name}" updated`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => REMOVE.matches(args),
            execute: async (args, store, logger) => {
                const { space, name } = REMOVE.getParams(args);
                store.deleteMemoryByName(space, name);
                logger.logInfo(style(`✅ Memory "${name}" removed from "${space}"`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => TAG_MEMORY.matches(args),
            execute: async (args, store, logger) => {
                const { space, name, tag } = TAG_MEMORY.getParams(args);
                const memory = store.getMemory(space, name);
                if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
                store.addMemoryTag(memory.id, tag);
                logger.logInfo(style(`✅ Tag #${normalizeTag(tag)} added to "${name}"`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => UNTAG_MEMORY.matches(args),
            execute: async (args, store, logger) => {
                const { space, name, tag } = UNTAG_MEMORY.getParams(args);
                const memory = store.getMemory(space, name);
                if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
                store.removeMemoryTag(memory.id, tag);
                logger.logInfo(style(`✅ Tag #${normalizeTag(tag)} removed from "${name}"`, ['bold', 'green']));
            },
        },
    ],
};
