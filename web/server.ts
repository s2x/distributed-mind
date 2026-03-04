import * as path from 'path';
import * as fs from 'fs';
import { createSqliteStore } from '../cli/src/store/sqlite-store';
import type { MindStore } from '../cli/src/store/mind-store';

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
            const memoriesMatch = p.match(/^\/api\/spaces\/([^/]+)\/memories$/);
            if (memoriesMatch && m === 'GET') {
                const spaceName = decodeURIComponent(memoriesMatch[1]!);
                const tier = url.searchParams.get('tier') ? Number(url.searchParams.get('tier')) as 1 | 2 | 3 : undefined;
                const tag = url.searchParams.get('tag') ?? undefined;
                return json(store.listMemories(spaceName, { tier, tag }));
            }

            // ── POST /api/spaces/:name/memories ──────────────────────────────
            if (memoriesMatch && m === 'POST') {
                const spaceName = decodeURIComponent(memoriesMatch[1]!);
                const { name, content, tags, tier } = await parseBody<{ name: string; content: string; tags?: string[]; tier?: 1 | 2 | 3 }>(req);
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
                    tier?: 1 | 2 | 3;
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
                const tier = url.searchParams.get('tier') ? Number(url.searchParams.get('tier')) as 1 | 2 | 3 : undefined;
                if (!q) return json([]);
                return json(store.search(q, { space, tag, tier }));
            }

            // ── GET /api/stats ────────────────────────────────────────────────
            if (p === '/api/stats' && m === 'GET') {
                const space = url.searchParams.get('space') ?? undefined;
                return json(store.stats(space));
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
