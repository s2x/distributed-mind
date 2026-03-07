import { ArgParser } from '../arg-parser';
import { style } from 'bun-style';
import { normalizeTag } from '../../helpers/tags';
import { formatTags } from '../../helpers/format';
import type { CommandGroup } from './types';

const p = ArgParser.param.bind(ArgParser);

const CREATE = new ArgParser(
    ['create|c', p('space'), p('description')],
    'Creates a new space',
    [{ name: 'tags', alias: 't', hasValue: true }]
);
const LIST = new ArgParser(
    ['list|ls|l'],
    'Lists all spaces',
    [{ name: 'tag', alias: 't', hasValue: true }]
);
const DELETE = new ArgParser(['delete|d', p('space')], 'Deletes a space and all its memories');
const RENAME = new ArgParser(['rename|rn', p('old'), p('new')], 'Renames a space');
const DESCRIBE = new ArgParser(['describe|ds', p('space'), p('description')], 'Changes a space description');
const TAG = new ArgParser(['tag|t', p('space'), p('tag')], 'Tags a space');
const UNTAG = new ArgParser(['untag', p('space'), p('tag')], 'Removes a tag from a space');

export const spacesGroup: CommandGroup = {
    name: 'Spaces',
    helpEntries: [CREATE, LIST, DELETE, RENAME, DESCRIBE, TAG, UNTAG],
    commands: [
        {
            matches: (args) => CREATE.matches(args),
            execute: async (args, store, logger) => {
                const { space, description } = CREATE.getParams(args);
                const flags = CREATE.getFlags(args);
                const tags = flags.tags ? String(flags.tags).split(',').map((t) => t.trim()) : undefined;
                store.createSpace(space, description, tags);
                logger.logInfo(style(`✅ Space "${space}" created`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => LIST.matches(args),
            execute: async (args, store, logger) => {
                const flags = LIST.getFlags(args);
                const tag = flags.tag ? String(flags.tag) : undefined;
                const spaces = store.listSpaces({ tag });

                if (spaces.length === 0) {
                    logger.logInfo('No spaces found');
                    return;
                }

                logger.logInfo(style('🧠 Spaces:', ['bold', 'magenta']));
                for (const s of spaces) {
                    const tags = formatTags(s.tags);
                    logger.logInfo(`   ${style(s.name, ['bold'])}: ${style(s.description, ['gray'])} (${s.memory_count} memories) ${tags}`);
                }
            },
        },
        {
            matches: (args) => DELETE.matches(args),
            execute: async (args, store, logger) => {
                const { space } = DELETE.getParams(args);
                store.deleteSpace(space);
                logger.logInfo(style(`✅ Space "${space}" deleted`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => RENAME.matches(args),
            execute: async (args, store, logger) => {
                const params = RENAME.getParams(args);
                store.renameSpace(params.old, params.new);
                logger.logInfo(style(`✅ Space "${params.old}" renamed to "${params.new}"`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => DESCRIBE.matches(args),
            execute: async (args, store, logger) => {
                const { space, description } = DESCRIBE.getParams(args);
                store.updateSpace(space, { description });
                logger.logInfo(style(`✅ Space "${space}" description updated`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => TAG.matches(args),
            execute: async (args, store, logger) => {
                const { space, tag } = TAG.getParams(args);
                store.addSpaceTag(space, tag);
                logger.logInfo(style(`✅ Tag #${normalizeTag(tag)} added to space "${space}"`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => UNTAG.matches(args),
            execute: async (args, store, logger) => {
                const { space, tag } = UNTAG.getParams(args);
                store.removeSpaceTag(space, tag);
                logger.logInfo(style(`✅ Tag #${normalizeTag(tag)} removed from space "${space}"`, ['bold', 'green']));
            },
        },
    ],
};
