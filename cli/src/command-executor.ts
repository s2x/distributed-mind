import { ArgParser } from './arg-parser';
import type { MindStore } from './store/mind-store';
import type { Logger } from './logger';
import type { Tier } from './types';
import { style } from 'bun-style';

const p = (name: string) => ArgParser.param(name);

const TIER_LABELS: Record<number, string> = {
    1: '🔴 T1 (hot)',
    2: '🟡 T2 (warm)',
    3: '🔵 T3 (cold)',
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
        'Lists memories of a space',
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
    READ_MEMORY: new ArgParser(['read|r', p('space'), p('name')], 'Reads a memory (bumps access + auto-promote)'),
    EDIT_MEMORY: new ArgParser(['edit|e', p('space'), p('name'), p('content')], 'Edits a memory content'),
    REMOVE_MEMORY: new ArgParser(['remove|rm', p('space'), p('name')], 'Removes a memory by name'),

    // Memory tags
    TAG_MEMORY: new ArgParser(['tag|t', p('space'), p('name'), p('tag')], 'Tags a memory'),
    UNTAG_MEMORY: new ArgParser(['untag', p('space'), p('name'), p('tag')], 'Removes a tag from a memory'),

    // Tiers
    PROMOTE: new ArgParser(['promote|up', p('space'), p('name')], 'Promotes a memory one tier up (3→2, 2→1)'),
    DEMOTE: new ArgParser(['demote|down', p('space'), p('name')], 'Demotes a memory one tier down (1→2, 2→3)'),
    PIN: new ArgParser(['pin', p('space'), p('name')], 'Pins a memory (immune to auto-demotion)'),
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
        'Full-text search across all memories. Use term* for prefix match.',
        [
            { name: 'space', hasValue: true },
            { name: 'tag', hasValue: true },
            { name: 'tier', hasValue: true },
            { name: 'detail', hasValue: false },
        ]
    ),

    // Maintenance
    TIDY: new ArgParser(['tidy'], 'Auto-demotes unused memories, shows GC candidates'),
    TIDY_SPACE: new ArgParser(['tidy', p('space')], 'Auto-demotes unused memories in a space'),
    GC: new ArgParser(
        ['gc'],
        'Removes old tier-3 memories',
        [{ name: 'days', hasValue: true }]
    ),
    STATS: new ArgParser(['stats'], 'Shows usage statistics'),
    STATS_SPACE: new ArgParser(['stats', p('space')], 'Shows usage statistics for a space'),

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

// ── Main executor ──

export function executeCommand(args: string[], store: MindStore, logger: Logger): void {
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
        logInfo(style('Maintenance:', ['bold', 'magenta']));
        for (const cmd of [CMD.TIDY, CMD.TIDY_SPACE, CMD.GC, CMD.STATS, CMD.STATS_SPACE]) {
            logInfo(`   ${cmd.getRendered()}`);
        }
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

        if (memories.length === 0) {
            logInfo('No memories found');
            return;
        }

        logInfo(style(`📋 Memories in ${space}:`, ['bold', 'magenta']));

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
        const memory = store.addMemory(space, name, content, { tags, tier });
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
        store.updateMemory(memory.id, { content });
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
        logInfo(style(`✅ Tag #${tag} added to "${name}"`, ['bold', 'green']));
        return;
    }

    // ── Tag space (2 params after tag) ──
    if (CMD.TAG_SPACE.matches(args)) {
        const { space, tag } = CMD.TAG_SPACE.getParams(args);
        store.addSpaceTag(space, tag);
        logInfo(style(`✅ Tag #${tag} added to space "${space}"`, ['bold', 'green']));
        return;
    }

    // ── Untag memory (3 params after untag) ──
    if (CMD.UNTAG_MEMORY.matches(args)) {
        const { space, name, tag } = CMD.UNTAG_MEMORY.getParams(args);
        const memory = store.getMemory(space, name);
        if (!memory) throw new Error(`Memory "${name}" not found in space "${space}"`);
        store.removeMemoryTag(memory.id, tag);
        logInfo(style(`✅ Tag #${tag} removed from "${name}"`, ['bold', 'green']));
        return;
    }

    // ── Untag space ──
    if (CMD.UNTAG_SPACE.matches(args)) {
        const { space, tag } = CMD.UNTAG_SPACE.getParams(args);
        store.removeSpaceTag(space, tag);
        logInfo(style(`✅ Tag #${tag} removed from space "${space}"`, ['bold', 'green']));
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

        const results = store.search(query, filter);
        if (results.length === 0) {
            logInfo('No results found');
            return;
        }

        logInfo(style(`🔍 ${results.length} result(s) for "${query}":`, ['bold', 'magenta']));
        for (const r of results) {
            const pin = r.pinned ? ' 📌' : '';
            logInfo(`   ${style(`${r.space_name}/${r.name}`, ['bold'])} [${tierLabel(r.tier)}]${pin}`);
            if (showDetail) {
                const preview = r.content.length > 120 ? r.content.slice(0, 120) + '...' : r.content;
                if (preview) logInfo(style(`      ${preview}`, ['dim']));
            }
        }
        return;
    }

    // ── Tidy (with space) ──
    if (CMD.TIDY_SPACE.matches(args)) {
        const { space } = CMD.TIDY_SPACE.getParams(args);
        runTidy(store, logger, space);
        return;
    }

    // ── Tidy (global) ──
    if (CMD.TIDY.matches(args)) {
        runTidy(store, logger);
        return;
    }

    // ── GC ──
    if (CMD.GC.matches(args)) {
        const flags = CMD.GC.getFlags(args);
        const days = flags.days ? parseInt(String(flags.days)) : undefined;
        const result = store.gc(days);

        if (result.removed.length === 0) {
            logInfo(style('✅ Nothing to clean up', ['bold', 'green']));
            return;
        }

        logInfo(style(`🗑️  Removed ${result.removed.length} memory(ies):`, ['bold', 'yellow']));
        for (const r of result.removed) {
            logInfo(`   ${style(`${r.space}/${r.name}`, ['dim'])}`);
        }
        return;
    }

    // ── Stats (with space) ──
    if (CMD.STATS_SPACE.matches(args)) {
        const { space } = CMD.STATS_SPACE.getParams(args);
        runStats(store, logger, space);
        return;
    }

    // ── Stats (global) ──
    if (CMD.STATS.matches(args)) {
        runStats(store, logger);
        return;
    }

    // ── Guide (with mode) ──
    if (CMD.GUIDE_MODE.matches(args)) {
        const { mode } = CMD.GUIDE_MODE.getParams(args);
        printGuide(logger, mode);
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

function runTidy(store: MindStore, logger: Logger, space?: string): void {
    const result = store.tidy(space);
    const scope = space ? ` in "${space}"` : '';

    if (result.demoted.length === 0 && result.candidates_for_gc.length === 0) {
        logger.logInfo(style(`✅ Everything is tidy${scope}`, ['bold', 'green']));
        return;
    }

    if (result.demoted.length > 0) {
        logger.logInfo(style(`⬇️  Demoted ${result.demoted.length} memory(ies)${scope}:`, ['bold', 'yellow']));
        for (const d of result.demoted) {
            logger.logInfo(
                `   ${style(`${d.space}/${d.name}`, ['bold'])}: ${tierLabel(d.from_tier)} → ${tierLabel(d.to_tier)}`
            );
        }
    }

    if (result.candidates_for_gc.length > 0) {
        logger.logInfo(
            style(`\n🗑️  ${result.candidates_for_gc.length} GC candidate(s)${scope} (run mind gc to remove):`, [
                'bold',
                'yellow',
            ])
        );
        for (const c of result.candidates_for_gc) {
            logger.logInfo(`   ${style(`${c.space}/${c.name}`, ['dim'])}`);
        }
    }
}

function runStats(store: MindStore, logger: Logger, space?: string): void {
    const stats = store.stats(space);
    const scope = space ? ` (${space})` : '';

    logger.logInfo(style(`📊 Stats${scope}:`, ['bold', 'magenta']));
    logger.logInfo(`   Spaces: ${stats.total_spaces}`);
    logger.logInfo(`   Memories: ${stats.total_memories}`);

    if (stats.by_tier.length > 0) {
        logger.logInfo('   By tier:');
        for (const t of stats.by_tier) {
            logger.logInfo(`      ${tierLabel(t.tier)}: ${t.count}`);
        }
    }

    if (stats.most_accessed.length > 0) {
        logger.logInfo('   Most accessed:');
        for (const m of stats.most_accessed.slice(0, 5)) {
            logger.logInfo(`      ${style(`${m.space}/${m.name}`, ['bold'])}: ${m.access_count} accesses`);
        }
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
        logInfo('mind is a persistent long-term memory system organized in spaces.');
        logInfo('Each memory has a tier (1=hot, 2=warm, 3=cold) managed by access patterns.');
        logInfo('');
        logInfo(style('Quick start:', ['bold']));
        logInfo('  1. List spaces:          mind list');
        logInfo('  2. Read a memory:        mind read <space> <name>');
        logInfo('  3. Search:               mind search <query>');
        logInfo('  4. Add a memory:         mind add <space> <name> <content> --tags t1,t2');
        logInfo('  5. Tag for categorization: mind tag <space> <name> <tag>');
        logInfo('');
        logInfo(style('Best practices:', ['bold']));
        logInfo('  - Use tags liberally for cross-cutting concerns');
        logInfo('  - Pin important memories: mind pin <space> <name>');
        logInfo('  - Read only what you need (tier 1 first, then search)');
        logInfo('  - Run mind tidy periodically to keep the mind clean');
        logInfo('  - Link related memories: mind link space/mem1 space/mem2 --label reason');
        logInfo('  - Use mind stats to understand usage patterns');
        logInfo('');
        logInfo(style('Tier system:', ['bold']));
        logInfo('  🔴 T1 (hot)  — Frequently accessed, always available');
        logInfo('  🟡 T2 (warm) — Default tier for new memories');
        logInfo('  🔵 T3 (cold) — Rarely used, candidates for cleanup');
        logInfo('  Reading a memory auto-promotes it. mind tidy auto-demotes unused ones.');
    } else {
        logInfo(style('🧠 mind — User Guide', ['bold', 'magenta']));
        logInfo('');
        logInfo('mind is a CLI tool for tracking thoughts, ideas, and knowledge.');
        logInfo('Data is organized in spaces, each containing memories with tiers.');
        logInfo('');
        logInfo(style('Getting started:', ['bold']));
        logInfo('  mind create my-project "Project notes"    Create a space');
        logInfo('  mind add my-project "auth-flow" "..."     Add a memory');
        logInfo('  mind list                                 List all spaces');
        logInfo('  mind list my-project                      List memories');
        logInfo('  mind read my-project auth-flow            Read a memory');
        logInfo('  mind search "authentication"              Full-text search (exact)');
    logInfo('  mind search "auth*"                       Prefix wildcard search');
    logInfo('  mind search "auth" --detail               With content preview');
        logInfo('');
        logInfo(style('Organization:', ['bold']));
        logInfo('  mind tag my-project project               Tag a space');
        logInfo('  mind tag my-project auth-flow backend     Tag a memory');
        logInfo('  mind promote my-project auth-flow         Move to higher tier');
        logInfo('  mind pin my-project auth-flow             Prevent auto-demotion');
        logInfo('  mind link proj/mem1 proj/mem2 --label x   Link memories');
        logInfo('');
        logInfo(style('Maintenance:', ['bold']));
        logInfo('  mind tidy                                 Auto-demote stale memories');
        logInfo('  mind gc                                   Remove old tier-3 memories');
        logInfo('  mind stats                                Usage statistics');
        logInfo('');
        logInfo('Run mind help for the full command reference.');
    }
}
