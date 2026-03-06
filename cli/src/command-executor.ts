import { ArgParser } from './arg-parser';
import type { MindStore } from './store/mind-store';
import type { Logger } from './logger';
import type { Tier } from './types';
import { TIER_LIMITS, CONFIG } from './config';
import { style } from 'bun-style';
import { normalizeTag } from './utils';

const p = (name: string) => ArgParser.param(name);

const TIER_LABELS: Record<number, string> = {
    1: '🔴 T1 (hot)',
    2: '🟡 T2 (warm)',
    3: '🔵 T3 (cold)',
    4: '💠 T4 (frozen)',
};

// ── Command definitions ──

const CMD = {
    HELP: new ArgParser(['help|h'], 'Lists all available commands'),

    // Spaces
    CREATE_SPACE: new ArgParser(
        ['create|c', p('space'), p('description')],
        'Creates a new space',
        [{ name: 'tags', alias: 't', hasValue: true }]
    ),
    LIST_SPACES: new ArgParser(
        ['list|ls|l'],
        'Lists all spaces',
        [{ name: 'tag', alias: 't', hasValue: true }]
    ),
    LIST_MEMORIES: new ArgParser(
        ['list|ls|l', p('space')],
        'Lists T1+T2 memories of a space (--tier 3 for cold)',
        [
            { name: 'tier', hasValue: true },
            { name: 'tag', alias: 't', hasValue: true },
        ]
    ),
    DELETE_SPACE: new ArgParser(['delete|d', p('space')], 'Deletes a space and all its memories'),
    RENAME_SPACE: new ArgParser(['rename|rn', p('old'), p('new')], 'Renames a space'),
    DESCRIBE_SPACE: new ArgParser(['describe|ds', p('space'), p('description')], 'Changes a space description'),
    TAG_SPACE: new ArgParser(['tag|t', p('space'), p('tag')], 'Tags a space'),
    UNTAG_SPACE: new ArgParser(['untag', p('space'), p('tag')], 'Removes a tag from a space'),

    // Memories
    ADD_MEMORY: new ArgParser(
        ['add|a', p('space'), p('name'), p('content')],
        'Adds a memory to a space',
        [
            { name: 'tags', alias: 't', hasValue: true },
            { name: 'tier', hasValue: true },
        ]
    ),
    READ_MEMORY: new ArgParser(['read|r', p('space'), p('name')], 'Reads a memory (bumps access + auto-promotes)'),
    EDIT_MEMORY: new ArgParser(['edit|e', p('space'), p('name'), p('content')], 'Edits a memory content'),
    REMOVE_MEMORY: new ArgParser(['remove|rm', p('space'), p('name')], 'Removes a memory by name'),

    // Memory tags
    TAG_MEMORY: new ArgParser(['tag|t', p('space'), p('name'), p('tag')], 'Tags a memory'),
    UNTAG_MEMORY: new ArgParser(['untag', p('space'), p('name'), p('tag')], 'Removes a tag from a memory'),

    // Tiers
    PROMOTE: new ArgParser(['promote|up', p('space'), p('name')], 'Promotes a memory one tier up (T4→T3, T3→T2, T2→T1)'),
    DEMOTE: new ArgParser(['demote|down', p('space'), p('name')], 'Demotes a memory one tier down (T1→T2, T2→T3, T3→T4)'),
    PIN: new ArgParser(['pin', p('space'), p('name')], 'Pins a memory (immune to auto-promotion)'),
    UNPIN: new ArgParser(['unpin', p('space'), p('name')], 'Unpins a memory'),

    // Links
    LINK: new ArgParser(
        ['link', p('source'), p('target')],
        'Links two memories (format: space/name)',
        [{ name: 'label', alias: 'l', hasValue: true }]
    ),
    UNLINK: new ArgParser(['unlink', p('source'), p('target')], 'Removes a link between two memories'),
    LINKS: new ArgParser(['links', p('space'), p('name')], 'Shows all links for a memory'),

    // Search
    SEARCH: new ArgParser(
        ['search|s', p('query')],
        'Full-text search across all memories (including T4). Use term* for prefix match.',
        [
            { name: 'space', hasValue: true },
            { name: 'tag', hasValue: true },
            { name: 'tier', hasValue: true },
            { name: 'detail', hasValue: false },
        ]
    ),

    // Status
    STATUS: new ArgParser(['status'], 'Shows storage info and per-tier breakdown'),
    STATUS_SPACE: new ArgParser(['status', p('space')], 'Shows tier breakdown for a specific space'),

    // Tags
    LIST_TAGS: new ArgParser(
        ['tags|tgs'],
        'Lists all tags in the system',
        [
            { name: 'spaces', hasValue: false, description: 'show only space tags' },
            { name: 'memories', hasValue: false, description: 'show only memory tags' },
        ]
    ),

    // Guide
    GUIDE: new ArgParser(['guide|g'], 'Shows usage guide'),
    GUIDE_MODE: new ArgParser(['guide|g', p('mode')], 'Shows usage guide (agent or human)'),

    // Migration
    IMPORT: new ArgParser(['import'], 'Imports data from legacy brain.json'),
};

// ── Helpers ──

function parseMemoryRef(ref: string): { space: string; name: string } {
    const slashIdx = ref.indexOf('/');
    if (slashIdx === -1) throw new Error(`Invalid memory reference "${ref}". Expected format: space/name`);
    return { space: ref.slice(0, slashIdx), name: ref.slice(slashIdx + 1) };
}

function tierLabel(tier: number): string {
    return TIER_LABELS[tier] ?? `T${tier}`;
}

function formatTags(tags: string[]): string {
    if (tags.length === 0) return '';
    return tags.map((t) => style(`#${t}`, ['cyan'])).join(' ');
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderCommands(cmds: ArgParser[], logger: Logger): void {
    const { logInfo } = logger;
    for (const cmd of cmds) {
        logInfo(`   ${cmd.getRendered()}`);
    }
}

// ── Main executor ──

export async function executeCommand(args: string[], store: MindStore, logger: Logger): Promise<void> {
    const { logInfo } = logger;

    if (args.length === 0) {
        throw new Error('No arguments provided. Run mind help for usage.');
    }

    // ── Help ──
    if (CMD.HELP.matches(args)) {
        logInfo(style('🧠 mind — long-term memory for agents and humans', ['bold']));
        logInfo('');
        logInfo(style('Spaces:', ['bold', 'magenta']));
        for (const cmd of [CMD.CREATE_SPACE, CMD.LIST_SPACES, CMD.DELETE_SPACE, CMD.RENAME_SPACE, CMD.DESCRIBE_SPACE, CMD.TAG_SPACE, CMD.UNTAG_SPACE]) {
            logInfo(`   ${cmd.getRendered()}`);
        }
        logInfo('');
        logInfo(style('Memories:', ['bold', 'magenta']));
        for (const cmd of [CMD.ADD_MEMORY, CMD.READ_MEMORY, CMD.EDIT_MEMORY, CMD.REMOVE_MEMORY, CMD.LIST_MEMORIES, CMD.TAG_MEMORY, CMD.UNTAG_MEMORY]) {
            logInfo(`   ${cmd.getRendered()}`);
        }
        logInfo('');
        logInfo(style('Tiers:', ['bold', 'magenta']));
        for (const cmd of [CMD.PROMOTE, CMD.DEMOTE, CMD.PIN, CMD.UNPIN]) {
            logInfo(`   ${cmd.getRendered()}`);
        }
        logInfo('');
        logInfo(style('Links:', ['bold', 'magenta']));
        for (const cmd of [CMD.LINK, CMD.UNLINK, CMD.LINKS]) {
            logInfo(`   ${cmd.getRendered()}`);
        }
        logInfo('');
        logInfo(style('Search:', ['bold', 'magenta']));
        logInfo(`   ${CMD.SEARCH.getRendered()}`);
        logInfo('');
        logInfo(style('Status:', ['bold', 'magenta']));
        for (const cmd of [CMD.STATUS, CMD.STATUS_SPACE]) {
            logInfo(`   ${cmd.getRendered()}`);
        }
        logInfo('');
        logInfo(style('Tags:', ['bold', 'magenta']));
        logInfo(`   ${CMD.LIST_TAGS.getRendered()}`);
        logInfo('');
        logInfo(style('Other:', ['bold', 'magenta']));
        for (const cmd of [CMD.GUIDE, CMD.GUIDE_MODE, CMD.IMPORT]) {
            logInfo(`   ${cmd.getRendered()}`);
        }
        return;
    }

    // ── Create space ──
    if (CMD.CREATE_SPACE.matches(args)) {
        const { space, description } = CMD.CREATE_SPACE.getParams(args);
        const flags = CMD.CREATE_SPACE.getFlags(args);
        const tags = flags.tags ? String(flags.tags).split(',').map((t: string) => t.trim()) : undefined;
        store.createSpace(space, description, tags);
        logInfo(style(`✅ Space "${space}" created`, ['bold', 'green']));
        return;
    }

    // ── List memories (must be before LIST_SPACES due to arg count) ──
    if (CMD.LIST_MEMORIES.matches(args)) {
        const { space } = CMD.LIST_MEMORIES.getParams(args);
        const flags = CMD.LIST_MEMORIES.getFlags(args);
        const tier = flags.tier ? (parseInt(String(flags.tier)) as Tier) : undefined;
        const tag = flags.tag ? String(flags.tag) : undefined;
        const memories = store.listMemories(space, { tier, tag });

        const scopeLabel = tier ? ` [${tierLabel(tier)}]` : ' [T1+T2]';

        if (memories.length === 0) {
            logInfo(`No memories found in ${style(space, ['magenta'])}${scopeLabel}`);
            return;
        }

        logInfo(style(`📋 ${space}${scopeLabel}:`, ['bold', 'magenta']));

        // Group by tier
        const byTier = new Map<number, typeof memories>();
        for (const m of memories) {
            if (!byTier.has(m.tier)) byTier.set(m.tier, []);
            byTier.get(m.tier)!.push(m);
        }

        for (const t of [1, 2, 3]) {
            const group = byTier.get(t);
            if (!group || group.length === 0) continue;
            logInfo(`   ${tierLabel(t)}`);
            for (const m of group) {
                const pin = m.pinned ? ' 📌' : '';
                const tags = formatTags(m.tags);
                logInfo(`      ${style(m.name, ['bold'])}${pin} ${tags}`);
            }
        }
        return;
    }

    // ── List spaces ──
    if (CMD.LIST_SPACES.matches(args)) {
        const flags = CMD.LIST_SPACES.getFlags(args);
        const tag = flags.tag ? String(flags.tag) : undefined;
        const spaces = store.listSpaces({ tag });

        if (spaces.length === 0) {
            logInfo('No spaces found');
            return;
        }

        logInfo(style('🧠 Spaces:', ['bold', 'magenta']));
        for (const s of spaces) {
            const tags = formatTags(s.tags);
            logInfo(
                `   ${style(s.name, ['bold'])}: ${style(s.description, ['gray'])} (${s.memory_count} memories) ${tags}`
            );
        }
        return;
    }

    // ── Delete space ──
    if (CMD.DELETE_SPACE.matches(args)) {
        const { space } = CMD.DELETE_SPACE.getParams(args);
        store.deleteSpace(space);
        logInfo(style(`✅ Space "${space}" deleted`, ['bold', 'green']));
        return;
    }

    // ── Rename space ──
    if (CMD.RENAME_SPACE.matches(args)) {
        const params = CMD.RENAME_SPACE.getParams(args);
        store.renameSpace(params.old, params.new);
        logInfo(style(`✅ Space "${params.old}" renamed to "${params.new}"`, ['bold', 'green']));
        return;
    }

    // ── Describe space ──
    if (CMD.DESCRIBE_SPACE.matches(args)) {
        const { space, description } = CMD.DESCRIBE_SPACE.getParams(args);
        store.updateSpace(space, { description });
        logInfo(style(`✅ Space "${space}" description updated`, ['bold', 'green']));
        return;
    }

    // ── Add memory ──
    if (CMD.ADD_MEMORY.matches(args)) {
        const { space, name, content } = CMD.ADD_MEMORY.getParams(args);
        const flags = CMD.ADD_MEMORY.getFlags(args);
        const tags = flags.tags ? String(flags.tags).split(',').map((t: string) => t.trim()) : undefined;
        const tier = flags.tier ? (parseInt(String(flags.tier)) as Tier) : undefined;
        if (tier !== undefined && (tier < 1 || tier > 3)) {
            throw new Error('--tier must be 1, 2, or 3 when adding a memory. T4 is reserved for auto-eviction.');
        }
        const memory = await store.addMemory(space, name, content, { tags, tier });
        logInfo(
            style('✅ Memory added: ', ['bold', 'green']) +
                `${style(memory.name, ['bold'])} in ${style(space, ['magenta'])} [${tierLabel(memory.tier)}]`
        );
        return;
    }

    // ── Read memory ──
    if (CMD.READ_MEMORY.matches(args)) {
        const { space, name } = CMD.READ_MEMORY.getParams(args);
        const memory = store.getMemory(space, name);
        if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);

        // Record access for auto-promotion
        store.recordAccess(memory.id);

        const pin = memory.pinned ? ' 📌' : '';
        const tags = formatTags(memory.tags);
        logInfo(style(`🛸 ${space} › ${memory.name}`, ['bold', 'blue']) + ` [${tierLabel(memory.tier)}]${pin}`);
        if (tags) logInfo(`   ${tags}`);
        if (memory.content) {
            logInfo(style(memory.content, ['dim']));
        } else {
            logInfo(style('(no content)', ['dim']));
        }
        return;
    }

    // ── Edit memory ──
    if (CMD.EDIT_MEMORY.matches(args)) {
        const { space, name, content } = CMD.EDIT_MEMORY.getParams(args);
        const memory = store.getMemory(space, name);
        if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
        await store.updateMemory(memory.id, { content });
        logInfo(style(`✅ Memory "${name}" updated`, ['bold', 'green']));
        return;
    }

    // ── Remove memory ──
    if (CMD.REMOVE_MEMORY.matches(args)) {
        const { space, name } = CMD.REMOVE_MEMORY.getParams(args);
        store.deleteMemoryByName(space, name);
        logInfo(style(`✅ Memory "${name}" removed from "${space}"`, ['bold', 'green']));
        return;
    }

    // ── Tag memory (3 params after tag) ──
    if (CMD.TAG_MEMORY.matches(args)) {
        const { space, name, tag } = CMD.TAG_MEMORY.getParams(args);
        const memory = store.getMemory(space, name);
        if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
        store.addMemoryTag(memory.id, tag);
        const normalizedMem = normalizeTag(tag);
        logInfo(style(`✅ Tag #${normalizedMem} added to "${name}"`, ['bold', 'green']));
        return;
    }

    // ── Tag space (2 params after tag) ──
    if (CMD.TAG_SPACE.matches(args)) {
        const { space, tag } = CMD.TAG_SPACE.getParams(args);
        store.addSpaceTag(space, tag);
        const normalizedSpace = normalizeTag(tag);
        logInfo(style(`✅ Tag #${normalizedSpace} added to space "${space}"`, ['bold', 'green']));
        return;
    }

    // ── Untag memory (3 params after untag) ──
    if (CMD.UNTAG_MEMORY.matches(args)) {
        const { space, name, tag } = CMD.UNTAG_MEMORY.getParams(args);
        const memory = store.getMemory(space, name);
        if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
        store.removeMemoryTag(memory.id, tag);
        const normalizedMem = normalizeTag(tag);
        logInfo(style(`✅ Tag #${normalizedMem} removed from "${name}"`, ['bold', 'green']));
        return;
    }

    // ── Untag space ──
    if (CMD.UNTAG_SPACE.matches(args)) {
        const { space, tag } = CMD.UNTAG_SPACE.getParams(args);
        store.removeSpaceTag(space, tag);
        const normalizedSpace = normalizeTag(tag);
        logInfo(style(`✅ Tag #${normalizedSpace} removed from space "${space}"`, ['bold', 'green']));
        return;
    }

    // ── Promote ──
    if (CMD.PROMOTE.matches(args)) {
        const { space, name } = CMD.PROMOTE.getParams(args);
        const memory = store.getMemory(space, name);
        if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
        store.promote(memory.id);
        const newTier = (memory.tier - 1) as Tier;
        logInfo(style(`✅ "${name}" promoted to ${tierLabel(newTier)}`, ['bold', 'green']));
        return;
    }

    // ── Demote ──
    if (CMD.DEMOTE.matches(args)) {
        const { space, name } = CMD.DEMOTE.getParams(args);
        const memory = store.getMemory(space, name);
        if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
        store.demote(memory.id);
        const newTier = (memory.tier + 1) as Tier;
        logInfo(style(`✅ "${name}" demoted to ${tierLabel(newTier)}`, ['bold', 'green']));
        return;
    }

    // ── Pin ──
    if (CMD.PIN.matches(args)) {
        const { space, name } = CMD.PIN.getParams(args);
        const memory = store.getMemory(space, name);
        if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
        store.pin(memory.id);
        logInfo(style(`📌 "${name}" pinned at ${tierLabel(memory.tier)}`, ['bold', 'green']));
        return;
    }

    // ── Unpin ──
    if (CMD.UNPIN.matches(args)) {
        const { space, name } = CMD.UNPIN.getParams(args);
        const memory = store.getMemory(space, name);
        if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
        store.unpin(memory.id);
        logInfo(style(`📌 "${name}" unpinned`, ['bold', 'green']));
        return;
    }

    // ── Link ──
    if (CMD.LINK.matches(args)) {
        const { source, target } = CMD.LINK.getParams(args);
        const flags = CMD.LINK.getFlags(args);
        const label = flags.label ? String(flags.label) : undefined;

        const src = parseMemoryRef(source);
        const tgt = parseMemoryRef(target);

        const srcMem = store.getMemory(src.space, src.name);
        if (!srcMem) throw new Error(`Memory "${src.name}" not found in space "${src.space}"`);
        const tgtMem = store.getMemory(tgt.space, tgt.name);
        if (!tgtMem) throw new Error(`Memory "${tgt.name}" not found in space "${tgt.space}"`);

        store.link(srcMem.id, tgtMem.id, label);
        logInfo(style(`🔗 Linked: ${source} → ${target}` + (label ? ` [${label}]` : ''), ['bold', 'green']));
        return;
    }

    // ── Unlink ──
    if (CMD.UNLINK.matches(args)) {
        const { source, target } = CMD.UNLINK.getParams(args);
        const src = parseMemoryRef(source);
        const tgt = parseMemoryRef(target);

        const srcMem = store.getMemory(src.space, src.name);
        if (!srcMem) throw new Error(`Memory "${src.name}" not found in space "${src.space}"`);
        const tgtMem = store.getMemory(tgt.space, tgt.name);
        if (!tgtMem) throw new Error(`Memory "${tgt.name}" not found in space "${tgt.space}"`);

        store.unlink(srcMem.id, tgtMem.id);
        logInfo(style(`🔗 Unlinked: ${source} ✕ ${target}`, ['bold', 'green']));
        return;
    }

    // ── Links ──
    if (CMD.LINKS.matches(args)) {
        const { space, name } = CMD.LINKS.getParams(args);
        const memory = store.getMemory(space, name);
        if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);

        const links = store.getLinks(memory.id);
        if (links.length === 0) {
            logInfo('No links found');
            return;
        }

        logInfo(style(`🔗 Links for ${space}/${name}:`, ['bold', 'blue']));
        for (const link of links) {
            const isSource = link.source_id === memory.id;
            const other = isSource
                ? `${link.target_space}/${link.target_name}`
                : `${link.source_space}/${link.source_name}`;
            const direction = isSource ? '→' : '←';
            logInfo(`   ${direction} ${style(other, ['bold'])} [${style(link.label, ['cyan'])}]`);
        }
        return;
    }

    // ── Search ──
    if (CMD.SEARCH.matches(args)) {
        const { query } = CMD.SEARCH.getParams(args);
        const flags = CMD.SEARCH.getFlags(args);
        const filter = {
            space: flags.space ? String(flags.space) : undefined,
            tag: flags.tag ? String(flags.tag) : undefined,
            tier: flags.tier ? (parseInt(String(flags.tier)) as Tier) : undefined,
        };
        const showDetail = !!flags.detail;

        const results = await store.search(query, filter);
        if (results.length === 0) {
            logInfo('No results found');
            return;
        }

        logInfo(style(`🔍 ${results.length} result(s) for "${query}":`, ['bold', 'magenta']));
        for (const r of results) {
            const pin = r.pinned ? ' 📌' : '';
            const sim = r.similarity !== undefined ? ` (${(r.similarity * 100).toFixed(1)}%)` : '';
            logInfo(`   ${style(`${r.space_name}/${r.name}`, ['bold'])} [${tierLabel(r.tier)}]${pin}${sim}`);
            if (showDetail) {
                const preview = r.content.length > 120 ? r.content.slice(0, 120) + '...' : r.content;
                if (preview) logInfo(style(`      ${preview}`, ['dim']));
            }
        }
        return;
    }

    // ── Status (with space) ──
    if (CMD.STATUS_SPACE.matches(args)) {
        const { space } = CMD.STATUS_SPACE.getParams(args);
        runStatus(store, logger, space);
        return;
    }

    // ── Status (global) ──
    if (CMD.STATUS.matches(args)) {
        runStatus(store, logger);
        return;
    }

    // ── Guide (with mode) ──
    if (CMD.GUIDE_MODE.matches(args)) {
        const { mode } = CMD.GUIDE_MODE.getParams(args);
        printGuide(logger, mode);
        return;
    }

    // ── Tags ──
    if (CMD.LIST_TAGS.matches(args)) {
        const flags = CMD.LIST_TAGS.getFlags(args);
        const showSpaces = flags.spaces !== undefined || (flags.spaces === undefined && flags.memories === undefined);
        const showMemories = flags.memories !== undefined || (flags.spaces === undefined && flags.memories === undefined);
        const tags = store.listAllTags();

        const allTags = [...tags.spaces, ...tags.memories];
        if (allTags.length === 0) {
            logInfo('No tags found');
            return;
        }

        if (showSpaces && tags.spaces.length > 0) {
            logInfo(style('🏷️  Space Tags:', ['bold', 'magenta']));
            const tagStr = tags.spaces.map((t) => style(`#${t.tag}`, ['cyan']) + style(` (${t.count})`, ['dim'])).join(' ');
            logInfo(`   ${tagStr}`);
            logInfo('');
        }

        if (showMemories && tags.memories.length > 0) {
            logInfo(style('🏷️  Memory Tags:', ['bold', 'magenta']));
            const tagStr = tags.memories.map((t) => style(`#${t.tag}`, ['cyan']) + style(` (${t.count})`, ['dim'])).join(' ');
            logInfo(`   ${tagStr}`);
        }
        return;
    }

    // ── Guide ──
    if (CMD.GUIDE.matches(args)) {
        printGuide(logger, 'human');
        return;
    }

    // ── Import ──
    if (CMD.IMPORT.matches(args)) {
        runImport(store, logger);
        return;
    }

    throw new Error(`Unknown command "${args[0]}". Run mind help for the list of valid commands.`);
}

// ── Sub-routines ──

function runStatus(store: MindStore, logger: Logger, space?: string): void {
    const { logInfo } = logger;
    const status = store.getStatus(space);

    if (space) {
        logInfo(style(`🧠 Status: ${space}`, ['bold', 'magenta']));
    } else {
        logInfo(style('🧠 Mind Status', ['bold', 'magenta']));
        logInfo('');
        logInfo(`   Storage:   ${style(status.db_path, ['dim'])} (${formatBytes(status.db_size_bytes)})`);
        logInfo(`   Spaces:    ${status.total_spaces}`);
        logInfo(`   Memories:  ${status.total_memories} total`);
    }

    logInfo('');
    logInfo('   Tier           Count  Pinned  Limit');
    logInfo('   ─────────────────────────────────────');

    // Emojis have inconsistent terminal width; keep them outside the padded label.
    const tierRows: { icon: string; label: string; limit: string; tier: 1 | 2 | 3 | 4 }[] = [
        { tier: 1, icon: '🔴', label: 'T1 hot    ', limit: `${TIER_LIMITS[1]}/space` },
        { tier: 2, icon: '🟡', label: 'T2 warm   ', limit: `${TIER_LIMITS[2]}/space` },
        { tier: 3, icon: '🔵', label: 'T3 cold   ', limit: `${TIER_LIMITS[3]}/space` },
        { tier: 4, icon: '💠', label: 'T4 frozen ', limit: '—' },
    ];

    for (const row of tierRows) {
        const data = status.by_tier.find((b) => b.tier === row.tier)!;
        const count = String(data.count).padStart(5);
        const pinned = String(data.pinned).padStart(6);
        logInfo(`   ${row.icon} ${row.label}  ${count}  ${pinned}  ${row.limit}`);
    }

    // RAG info
    logInfo('');
    if (status.rag_enabled) {
        logInfo(`   ${style('RAG:', ['bold'])} enabled (${CONFIG.rag.model})`);
        logInfo(`   ${style('Embeddings:', ['bold'])} ${status.embeddings_indexed}/${status.total_memories} indexed`);
    } else {
        logInfo(`   ${style('RAG:', ['bold'])} disabled (set MIND_RAG=true + OPENAI_API_KEY)`);
    }
}

function runImport(store: MindStore, logger: Logger): void {
    const fs = require('fs') as typeof import('fs');
    const { CONFIG } = require('./config') as { CONFIG: typeof import('./config').CONFIG };

    if (!fs.existsSync(CONFIG.legacyJsonPath)) {
        throw new Error(`No legacy brain.json found at ${CONFIG.legacyJsonPath}`);
    }

    const raw = fs.readFileSync(CONFIG.legacyJsonPath, 'utf8');
    const brain = JSON.parse(raw);
    store.importFromJson(brain);
    logger.logInfo(style('✅ Import complete', ['bold', 'green']));

    const spaces = Object.keys(brain);
    const memories = spaces.reduce((acc: number, s: string) => acc + (brain[s].memories?.length ?? 0), 0);
    logger.logInfo(`   ${spaces.length} space(s), ${memories} memory(ies) imported`);
}

function printGuide(logger: Logger, mode: string): void {
    const { logInfo } = logger;

    if (mode === 'agent') {
        logInfo(style('🤖 mind — Agent Guide', ['bold', 'magenta']));
        logInfo('');
        logInfo('mind is a persistent long-term memory system. Data is organized in spaces,');
        logInfo('each containing memories. Run mind help for the full command reference.');
        logInfo('');
        logInfo(style('Data model:', ['bold']));
        logInfo('  Space    Namespace with a name, description, and tags.');
        logInfo('  Memory   Key-value entry: name, content, tier (1–4), tags.');
        logInfo('  Tier     🔴 T1 hot (25/space) → 🟡 T2 warm (50/space, default)');
        logInfo('           → 🔵 T3 cold (100/space) → 💠 T4 frozen (unlimited).');
        logInfo('           Reading a non-pinned memory auto-promotes it one tier up.');
        logInfo('           Promotion uses LRU eviction if the destination tier is full.');
        logInfo('           T4 entries are only reachable via search, not list.');
        logInfo('  Pin      Pinned memories are never auto-promoted or LRU-evicted.');
        logInfo('  Link     Directional edge between two memories with a label.');
        logInfo('');
        logInfo(style('Spaces:', ['bold']));
        renderCommands([CMD.CREATE_SPACE, CMD.LIST_SPACES, CMD.DELETE_SPACE, CMD.RENAME_SPACE, CMD.DESCRIBE_SPACE, CMD.TAG_SPACE, CMD.UNTAG_SPACE], logger);
        logInfo('');
        logInfo(style('Memories:', ['bold']));
        renderCommands([CMD.ADD_MEMORY, CMD.READ_MEMORY, CMD.EDIT_MEMORY, CMD.REMOVE_MEMORY, CMD.LIST_MEMORIES, CMD.TAG_MEMORY, CMD.UNTAG_MEMORY], logger);
        logInfo('');
        logInfo(style('Search:', ['bold']));
        renderCommands([CMD.SEARCH], logger);
        logInfo('');
        logInfo(style('Organization:', ['bold']));
        renderCommands([CMD.TAG_SPACE, CMD.UNTAG_SPACE, CMD.LIST_TAGS, CMD.PROMOTE, CMD.DEMOTE, CMD.PIN, CMD.UNPIN, CMD.LINK, CMD.UNLINK, CMD.LINKS], logger);
        logInfo('');
        logInfo(style('Status:', ['bold']));
        renderCommands([CMD.STATUS, CMD.STATUS_SPACE], logger);
        logInfo('');
        logInfo(style('Considerations:', ['bold']));
        logInfo('  Tags: normalized on creation (lowercase, # prefix stripped).');
        logInfo('  Valid chars: a-z, 0-9, -, _, ., :, /, =, +, @');
        logInfo('');
        logInfo(style('Best practices:', ['bold']));
        logInfo('  - Search before adding to avoid duplicates (search covers T4 too)');
        logInfo('  - Use tags for cross-cutting concerns (project, topic, type)');
        logInfo('  - Pin critical memories to prevent auto-promotion and LRU eviction');
        logInfo('  - Prefer search over listing for large spaces');
        logInfo('  - T4 memories are frozen but still searchable');
        logInfo('  - Run mind help for the full command reference');
    } else {
        logInfo(style('🧠 mind — User Guide', ['bold', 'magenta']));
        logInfo('');
        logInfo('mind is a CLI tool for tracking thoughts, ideas, and knowledge.');
        logInfo('Data is organized in spaces, each containing memories with tiers.');
        logInfo('');
        logInfo(style('Getting started:', ['bold']));
        renderCommands([CMD.HELP, CMD.CREATE_SPACE, CMD.ADD_MEMORY, CMD.LIST_SPACES, CMD.LIST_MEMORIES, CMD.READ_MEMORY, CMD.EDIT_MEMORY, CMD.REMOVE_MEMORY, CMD.DELETE_SPACE], logger);
        logInfo('');
        logInfo(style('Search:', ['bold']));
        renderCommands([CMD.SEARCH], logger);
        logInfo('');
        logInfo(style('Tiers (CPU-cache style):', ['bold']));
        logInfo('  🔴 T1 hot    (25/space)  — Frequently accessed');
        logInfo('  🟡 T2 warm   (50/space)  — Default for new memories');
        logInfo('  🔵 T3 cold   (100/space) — Rarely used');
        logInfo('  💠 T4 frozen (unlimited) — Archive; only reachable via search');
        logInfo('  Reading a memory auto-promotes it one tier up (LRU eviction if tier is full).');
        logInfo('  Pinned memories are immune to auto-promotion and LRU eviction.');
        logInfo('');
        logInfo(style('Organization:', ['bold']));
        renderCommands([CMD.TAG_SPACE, CMD.UNTAG_SPACE, CMD.LIST_TAGS, CMD.PROMOTE, CMD.DEMOTE, CMD.PIN, CMD.UNPIN, CMD.LINK, CMD.UNLINK, CMD.LINKS], logger);
        logInfo('');
        logInfo(style('Status:', ['bold']));
        renderCommands([CMD.STATUS, CMD.STATUS_SPACE], logger);
        logInfo('');
        logInfo(style('Considerations:', ['bold']));
        logInfo('  Tags: normalized on creation (lowercase, # prefix stripped).');
        logInfo('  Valid chars: a-z, 0-9, -, _, ., :, /, =, +, @');
        logInfo('');
        logInfo('Run mind help for the full command reference.');
    }
}
