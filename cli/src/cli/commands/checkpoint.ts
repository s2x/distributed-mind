import { ArgParser } from '../arg-parser';
import { style } from '../../helpers/style';
import { formatTags } from '../../helpers/format';
import type { CommandGroup } from './types';
import { buildRecoveryPack, renderRecoveryPack, type RecoveryFormat } from '../../checkpoint/recovery-pack';
import { isAgent, type Agent } from '../capabilities';

const p = ArgParser.param.bind(ArgParser);

const SET = new ArgParser(
    ['checkpoint set|cp set', p('space'), p('goal'), p('pending')],
    'Creates or updates a checkpoint for the current work session',
    [{ name: 'notes', alias: 'n', hasValue: true }]
);

const COMPLETE = new ArgParser(
    ['checkpoint complete|cp complete|checkpoint done|cp done', p('space'), p('id'), p('what')],
    'Marks a checkpoint as completed',
    []
);

const RECOVER = new ArgParser(
    ['checkpoint recover|cp recover', p('space')],
    'Recovers the most recent active checkpoint',
    [
        { name: 'history', alias: 'H', hasValue: false },
        { name: 'format', alias: 'f', hasValue: true },
        { name: 'agent', alias: 'a', hasValue: true },
    ]
);

const LIST = new ArgParser(['checkpoint list|cp list', p('space')], 'Lists all checkpoints for a space', [
    { name: 'status', alias: 'S', hasValue: true },
]);

function getCheckpointSpaceName(space: string): string {
    return `${space}:sessions`;
}

export const checkpointGroup: CommandGroup = {
    name: 'Checkpoint',
    helpEntries: [SET, COMPLETE, RECOVER, LIST],
    commands: [
        {
            matches: (args) => SET.matches(args),
            execute: async (args, store, logger) => {
                const params = SET.getParams(args);
                const flags = SET.getFlags(args);
                const space = params.space;
                const goal = params.goal;
                const pending = params.pending;
                const notes = flags.notes ? String(flags.notes) : undefined;

                const checkpointSpace = getCheckpointSpaceName(space);

                // Create hidden checkpoint space if it doesn't exist
                const existingSpace = store.getSpace(checkpointSpace);
                if (!existingSpace) {
                    store.createSpace(checkpointSpace, `Checkpoints for ${space}`, ['checkpoint', 'system']);
                    store.updateSpace(checkpointSpace, { hidden: true });
                }

                // Build checkpoint content as JSON
                const content = JSON.stringify(
                    {
                        goal,
                        pending,
                        notes: notes || '',
                        createdAt: new Date().toISOString(),
                    },
                    null,
                    2
                );

                // Check if there's already an active checkpoint
                const existingCheckpoints = store.listMemories(checkpointSpace, { tag: 'checkpoint' });
                const activeCheckpoint = existingCheckpoints.find((m) => m.tags.includes('active'));

                let checkpoint;
                if (activeCheckpoint) {
                    // Update existing active checkpoint
                    const memory = store.getMemoryById(activeCheckpoint.id);
                    if (memory) {
                        const existingContent = JSON.parse(memory.content);
                        existingContent.goal = goal;
                        existingContent.pending = pending;
                        existingContent.notes = notes || '';
                        existingContent.updatedAt = new Date().toISOString();

                        await store.updateMemory(activeCheckpoint.id, {
                            content: JSON.stringify(existingContent, null, 2),
                        });
                        checkpoint = store.getMemoryById(activeCheckpoint.id);
                    }
                } else {
                    // Create new checkpoint
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    checkpoint = await store.addMemory(checkpointSpace, `checkpoint-${timestamp}`, content, {
                        tags: ['checkpoint', 'active'],
                        tier: 1,
                    });
                }

                const status = activeCheckpoint ? 'updated' : 'created';
                logger.logInfo(style(`✅ Checkpoint ${status} in "${checkpointSpace}"`, ['bold', 'green']));
                if (checkpoint) {
                    logger.logInfo(style(`   ID: ${checkpoint.id}`, ['dim']));
                }
            },
        },
        {
            matches: (args) => COMPLETE.matches(args),
            execute: async (args, store, logger) => {
                const params = COMPLETE.getParams(args);
                const space = params.space;
                const checkpointId = parseInt(params.id, 10);
                const whatWasDone = params.what;

                const checkpointSpace = getCheckpointSpaceName(space);
                const memory = store.getMemoryById(checkpointId);

                if (!memory) {
                    logger.logInfo(style(`❌ Checkpoint with id ${checkpointId} not found`, ['red']));
                    return;
                }

                if (memory.space_name !== checkpointSpace) {
                    logger.logInfo(
                        style(`❌ Checkpoint ${checkpointId} does not belong to "${checkpointSpace}"`, ['red'])
                    );
                    return;
                }

                // Update content with what was done
                const existingContent = JSON.parse(memory.content);
                existingContent.whatWasDone = whatWasDone;
                existingContent.completedAt = new Date().toISOString();

                await store.updateMemory(checkpointId, {
                    content: JSON.stringify(existingContent, null, 2),
                });

                // Update tags
                store.removeMemoryTag(checkpointId, 'active');
                store.addMemoryTag(checkpointId, 'completed');

                // Demote to T2
                try {
                    store.demote(checkpointId);
                } catch {
                    // Might be at T1 already or at max capacity
                }

                logger.logInfo(style(`✅ Checkpoint marked as completed and demoted to warm tier`, ['bold', 'green']));
            },
        },
        {
            matches: (args) => RECOVER.matches(args),
            execute: async (args, store, logger) => {
                const params = RECOVER.getParams(args);
                const flags = RECOVER.getFlags(args);
                const space = params.space;
                const includeHistory = flags.history === true;
                const requestedFormat = String(flags.format ?? 'text') as RecoveryFormat;
                const requestedAgent = flags.agent ? String(flags.agent) : 'opencode';

                if (!['text', 'md', 'json'].includes(requestedFormat)) {
                    throw new Error('--format must be one of: text, md, json');
                }
                if (!isAgent(requestedAgent)) {
                    throw new Error(`Unknown --agent value: ${requestedAgent}`);
                }

                const recoveryPack = await buildRecoveryPack(store, {
                    space,
                    includeHistory,
                    agent: requestedAgent as Agent,
                });

                logger.logInfo(renderRecoveryPack(recoveryPack, requestedFormat));
            },
        },
        {
            matches: (args) => LIST.matches(args),
            execute: async (args, store, logger) => {
                const params = LIST.getParams(args);
                const flags = LIST.getFlags(args);
                const space = params.space;
                const status = flags.status ? String(flags.status) : undefined;

                const checkpointSpace = getCheckpointSpaceName(space);

                // Check if checkpoint space exists
                const checkpointSpaceExists = store.getSpace(checkpointSpace);
                if (!checkpointSpaceExists) {
                    logger.logInfo(style(`ℹ️  No checkpoint space found for "${space}"`, ['yellow']));
                    return;
                }

                // Get all checkpoints
                let checkpoints = store.listMemories(checkpointSpace, { tag: 'checkpoint' });

                // Filter by status if specified
                if (status && status !== 'all') {
                    checkpoints = checkpoints.filter((m) => m.tags.includes(status));
                }

                // Sort by updated_at descending
                checkpoints.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

                if (checkpoints.length === 0) {
                    logger.logInfo(style(`ℹ️  No checkpoints found`, ['yellow']));
                    return;
                }

                logger.logInfo(style(`📋 Checkpoints for "${space}":`, ['bold', 'cyan']));
                for (const cp of checkpoints) {
                    const statusBadge = cp.tags.includes('active')
                        ? style(' [active]', ['green'])
                        : style(' [completed]', ['dim']);
                    logger.logInfo(style(`   #${cp.id} ${cp.name}${statusBadge}`, []));
                    logger.logInfo(style(`       Updated: ${cp.updated_at}`, ['dim']));
                }
            },
        },
    ],
};
