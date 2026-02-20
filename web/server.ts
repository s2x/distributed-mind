import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.join(import.meta.dir, '..');
const dataDir = process.env.BRAIN_DATA_DIR ?? 'data';
const defaultBrainPath = path.isAbsolute(dataDir)
    ? path.join(dataDir, 'brain.json')
    : path.join(repoRoot, dataDir, 'brain.json');
const BRAIN_PATH = process.env.BRAIN_PATH ?? defaultBrainPath;
const PORT = parseInt(process.env.PORT ?? '3000', 10);

interface Memory {
    name: string;
    description: string;
}

function getBrain(): Record<string, { description: string; memories: Memory[] }> {
    if (!fs.existsSync(BRAIN_PATH)) {
        return {};
    }
    const raw = fs.readFileSync(BRAIN_PATH, 'utf8');
    return JSON.parse(raw) as Record<string, { description: string; memories: Memory[] }>;
}

function saveBrain(brain: Record<string, { description: string; memories: Memory[] }>): void {
    const dir = path.dirname(BRAIN_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(BRAIN_PATH, JSON.stringify(brain, null, 4));
}

const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/api/brain') {
            if (req.method === 'GET') {
                return Response.json(getBrain());
            }
            if (req.method === 'PUT') {
                const body = (await req.json()) as Record<string, { description: string; memories: Memory[] }>;
                saveBrain(body);
                return Response.json(getBrain());
            }
            return new Response('Method not allowed', { status: 405 });
        }
        const filePath = path.join(import.meta.dir, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
        if (!filePath.startsWith(path.join(import.meta.dir, 'public'))) {
            return new Response('Not found', { status: 404 });
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            return new Response(fs.readFileSync(path.join(import.meta.dir, 'public', 'index.html')), {
                headers: { 'Content-Type': 'text/html' },
            });
        }
        const ext = path.extname(filePath);
        const types: Record<string, string> = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.ico': 'image/x-icon',
        };
        return new Response(fs.readFileSync(filePath), {
            headers: { 'Content-Type': types[ext] ?? 'application/octet-stream' },
        });
    },
});

console.log(`mind web running at http://localhost:${server.port}`);
