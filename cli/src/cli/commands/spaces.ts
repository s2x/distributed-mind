import { ArgParser } from '../arg-parser';
import { style } from '../../helpers/style';
import { normalizeTag } from '../../helpers/tags';
import { formatTags } from '../../helpers/format';
import type { CommandGroup } from './types';

const p = ArgParser.param.bind(ArgParser);

const CREATE = new ArgParser(['create|c', p('space'), p('description')], 'Creates a new space', [
    { name: 'tags', alias: 't', hasValue: true },
]);
const LIST = new ArgParser(['list|ls|l'], 'Lists all spaces', [
    { name: 'tag', alias: 't', hasValue: true },
    { name: 'hidden', alias: 'H', hasValue: false },
]);
const UPDATE = new ArgParser(['update', p('space')], 'Updates a space (description or visibility)', [
    { name: 'description', alias: 'd', hasValue: true },
    { name: 'hidden', alias: 'H', hasValue: false },
    { name: 'no-hidden', hasValue: false },
]);
const DELETE = new ArgParser(['delete|d', p('space')], 'Deletes a space and all its memories');
const RENAME = new ArgParser(['rename|rn', p('old'), p('new')], 'Renames a space');
const DESCRIBE = new ArgParser(['describe|ds', p('space'), p('description')], 'Changes a space description');
const TAG = new ArgParser(['tag|t', p('space'), p('tag')], 'Tags a space');
const UNTAG = new ArgParser(['untag', p('space'), p('tag')], 'Removes a tag from a space');

export const spacesGroup: CommandGroup = {
    name: 'Spaces',
    helpEntries: [CREATE, LIST, DELETE, RENAME, UPDATE, DESCRIBE, TAG, UNTAG],
    commands: [
        {
            matches: (args) => CREATE.matches(args),
            execute: async (args, store, logger) => {
                const { space, description } = CREATE.getParams(args);
                const flags = CREATE.getFlags(args);
                const tags = flags.tags
                    ? String(flags.tags)
                          .split(',')
                          .map((t) => t.trim())
                    : undefined;
                store.createSpace(space, description, tags);
                logger.logInfo(style(`✅ Space "${space}" created`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => LIST.matches(args),
            execute: async (args, store, logger) => {
                const flags = LIST.getFlags(args);
                const tag = flags.tag ? String(flags.tag) : undefined;
                const includeHidden = flags.hidden === true;
                const spaces = store.listSpaces({ tag, includeHidden });

                if (spaces.length === 0) {
                    logger.logInfo('No spaces found');
                    return;
                }

                logger.logInfo(style('🧠 Spaces:', ['bold', 'magenta']));
                for (const s of spaces) {
                    const tags = formatTags(s.tags);
                    const hiddenBadge = s.hidden ? style(' [hidden]', ['gray', 'dim']) : '';
                    logger.logInfo(
                        `   ${style(s.name, ['bold'])}: ${style(s.description, ['gray'])} (${s.memory_count} memories) ${tags}${hiddenBadge}`
                    );
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
            matches: (args) => UPDATE.matches(args),
            execute: async (args, store, logger) => {
                const { space } = UPDATE.getParams(args);
                const flags = UPDATE.getFlags(args);
                const updates: { description?: string; hidden?: boolean } = {};

                if (flags.description !== undefined) {
                    updates.description = String(flags.description);
                }
                if (flags.hidden === true) {
                    updates.hidden = true;
                } else if (flags['no-hidden'] === true) {
                    updates.hidden = false;
                }

                if (Object.keys(updates).length === 0) {
                    logger.logInfo(
                        style('⚠️  No updates provided. Use --description or --hidden/--no-hidden', ['yellow'])
                    );
                    return;
                }

                store.updateSpace(space, updates);

                const parts: string[] = [];
                if (updates.description !== undefined) parts.push('description');
                if (updates.hidden !== undefined) parts.push(updates.hidden ? 'hidden' : 'visible');

                logger.logInfo(style(`✅ Space "${space}" updated: ${parts.join(', ')}`, ['bold', 'green']));
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
