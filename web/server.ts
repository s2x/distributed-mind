import * as path from 'path';
import * as fs from 'fs';
import { createSqliteStore } from '../cli/src/store/sqlite-store';
import type { MindStore } from '../cli/src/store/mind-store';
import type { Tier } from '../cli/src/types';

// ── Config ──────────────────────────────────────────────────────────────────
const repoRoot = path.join(import.meta.dir, '..');
const dataDir = process.env.MIND_DATA_DIR ?? path.join(repoRoot, 'data');
const resolvedDataDir = path.isAbsolute(dataDir) ? dataDir : path.join(repoRoot, dataDir);
const dbPath = path.join(resolvedDataDir, 'mind.db');
const PORT = parseInt(process.env.PORT ?? '3000', 10);

if (!fs.existsSync(resolvedDataDir)) {
    fs.mkdirSync(resolvedDataDir, { recursive: true });
}

const store: MindStore = createSqliteStore(dbPath);

// ── Helpers ─────────────────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
    return Response.json(data, { status });
}

function err(msg: string, status = 400): Response {
    return Response.json({ error: msg }, { status });
}

function parseBody<T>(req: Request): Promise<T> {
    return req.json() as Promise<T>;
}

function staticFile(pathname: string): Response {
    const publicDir = path.join(import.meta.dir, 'public');
    const safePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
    if (!safePath.startsWith(publicDir)) return new Response('Forbidden', { status: 403 });

    if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
        // SPA fallback
        return new Response(fs.readFileSync(path.join(publicDir, 'index.html')), {
            headers: { 'Content-Type': 'text/html' },
        });
    }

    const ext = path.extname(safePath);
    const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.ico': 'image/x-icon',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
    };
    return new Response(fs.readFileSync(safePath), {
        headers: { 'Content-Type': types[ext] ?? 'application/octet-stream' },
    });
}

function parseTier(raw: string | null): Tier | undefined {
    if (!raw) return undefined;
    const n = Number(raw);
    if (n >= 1 && n <= 4) return n as Tier;
    return undefined;
}

// ── Router ───────────────────────────────────────────────────────────────────
const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);
        const p = url.pathname;
        const m = req.method;

        try {
            // ── GET /api/spaces ──────────────────────────────────────────────
            if (p === '/api/spaces' && m === 'GET') {
                const tag = url.searchParams.get('tag') ?? undefined;
                return json(store.listSpaces(tag ? { tag } : undefined));
            }

            // ── POST /api/spaces ─────────────────────────────────────────────
            if (p === '/api/spaces' && m === 'POST') {
                const { name, description, tags } = await parseBody<{ name: string; description: string; tags?: string[] }>(req);
                store.createSpace(name, description ?? '', tags);
                return json(store.getSpace(name), 201);
            }

            // ── GET /api/spaces/:name ────────────────────────────────────────
            const spaceMatch = p.match(/^\/api\/spaces\/([^/]+)$/);
            if (spaceMatch && m === 'GET') {
                const space = store.getSpace(decodeURIComponent(spaceMatch[1]!));
                if (!space) return err('Space not found', 404);
                return json(space);
            }

            // ── PATCH /api/spaces/:name ──────────────────────────────────────
            if (spaceMatch && m === 'PATCH') {
                const name = decodeURIComponent(spaceMatch[1]!);
                const body = await parseBody<{ description?: string; newName?: string; addTag?: string; removeTag?: string }>(req);
                if (body.description !== undefined) store.updateSpace(name, { description: body.description });
                if (body.newName) store.renameSpace(name, body.newName);
                if (body.addTag) store.addSpaceTag(body.newName ?? name, body.addTag);
                if (body.removeTag) store.removeSpaceTag(body.newName ?? name, body.removeTag);
                return json(store.getSpace(body.newName ?? name));
            }

            // ── DELETE /api/spaces/:name ─────────────────────────────────────
            if (spaceMatch && m === 'DELETE') {
                store.deleteSpace(decodeURIComponent(spaceMatch[1]!));
                return json({ ok: true });
            }

            // ── GET /api/spaces/:name/memories ───────────────────────────────
            // When no tier filter is given, the web UI wants T1+T2+T3 (all listable
            // tiers). T4 is frozen and only reachable via search. We fetch T1, T2, T3
            // individually and combine, to avoid the CLI's T1+T2 default.
            const memoriesMatch = p.match(/^\/api\/spaces\/([^/]+)\/memories$/);
            if (memoriesMatch && m === 'GET') {
                const spaceName = decodeURIComponent(memoriesMatch[1]!);
                const tier = parseTier(url.searchParams.get('tier'));
                const tag = url.searchParams.get('tag') ?? undefined;

                if (tier !== undefined) {
                    // Explicit tier requested — return only that tier (T4 returns [])
                    return json(store.listMemories(spaceName, { tier, tag }));
                }

                // No tier filter: return T1+T2+T3 combined for the web UI
                const t1 = store.listMemories(spaceName, { tier: 1, tag });
                const t2 = store.listMemories(spaceName, { tier: 2, tag });
                const t3 = store.listMemories(spaceName, { tier: 3, tag });
                return json([...t1, ...t2, ...t3]);
            }

            // ── POST /api/spaces/:name/memories ──────────────────────────────
            if (memoriesMatch && m === 'POST') {
                const spaceName = decodeURIComponent(memoriesMatch[1]!);
                const { name, content, tags, tier } = await parseBody<{
                    name: string;
                    content: string;
                    tags?: string[];
                    tier?: 1 | 2 | 3; // T4 cannot be set directly
                }>(req);
                if (tier !== undefined && (tier < 1 || tier > 3)) {
                    return err('tier must be 1, 2, or 3. T4 is reserved for auto-eviction.', 400);
                }
                const memory = store.addMemory(spaceName, name, content, { tags, tier });
                return json(memory, 201);
            }

            // ── GET /api/spaces/:space/memories/:name ────────────────────────
            const memMatch = p.match(/^\/api\/spaces\/([^/]+)\/memories\/([^/]+)$/);
            if (memMatch && m === 'GET') {
                const memory = store.getMemory(decodeURIComponent(memMatch[1]!), decodeURIComponent(memMatch[2]!));
                if (!memory) return err('Memory not found', 404);
                return json(memory);
            }

            // ── PATCH /api/spaces/:space/memories/:name ──────────────────────
            if (memMatch && m === 'PATCH') {
                const spaceName = decodeURIComponent(memMatch[1]!);
                const memName = decodeURIComponent(memMatch[2]!);
                const memory = store.getMemory(spaceName, memName);
                if (!memory) return err('Memory not found', 404);

                const body = await parseBody<{
                    content?: string;
                    pinned?: boolean;
                    addTag?: string;
                    removeTag?: string;
                    promote?: boolean;
                    demote?: boolean;
                }>(req);

                if (body.content !== undefined) store.updateMemory(memory.id, { content: body.content });
                if (body.promote) store.promote(memory.id);
                if (body.demote) store.demote(memory.id);
                if (body.pinned === true) store.pin(memory.id);
                if (body.pinned === false) store.unpin(memory.id);
                if (body.addTag) store.addMemoryTag(memory.id, body.addTag);
                if (body.removeTag) store.removeMemoryTag(memory.id, body.removeTag);

                return json(store.getMemoryById(memory.id));
            }

            // ── DELETE /api/spaces/:space/memories/:name ─────────────────────
            if (memMatch && m === 'DELETE') {
                store.deleteMemoryByName(decodeURIComponent(memMatch[1]!), decodeURIComponent(memMatch[2]!));
                return json({ ok: true });
            }

            // ── GET /api/search ───────────────────────────────────────────────
            if (p === '/api/search' && m === 'GET') {
                const q = url.searchParams.get('q') ?? '';
                const space = url.searchParams.get('space') ?? undefined;
                const tag = url.searchParams.get('tag') ?? undefined;
                const tier = parseTier(url.searchParams.get('tier'));
                if (!q) return json([]);
                return json(await store.search(q, { space, tag, tier }));
            }

            // ── GET /api/status ───────────────────────────────────────────────
            if (p === '/api/status' && m === 'GET') {
                const space = url.searchParams.get('space') ?? undefined;
                return json(store.getStatus(space));
            }

            // ── Static files ─────────────────────────────────────────────────
            return staticFile(p);

        } catch (e: any) {
            console.error('API error:', e.message);
            return err(e.message, 500);
        }
    },
});

console.log(`mind web running at http://localhost:${server.port}`);
