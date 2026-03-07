import * as fs from 'fs';
import * as path from 'path';
import { CONFIG } from '../config';
import { createSqliteStore } from '../store/sqlite-store';
import type { MindStore } from '../store/mind-store';
import { matchApiRoute } from './router';

function resolveStaticFile(pathname: string): Response {
  const publicDir = path.join(import.meta.dir, '..', '..', '..', 'web', 'public');
  const candidate = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);

  if (!candidate.startsWith(publicDir)) {
    return new Response('Forbidden', { status: 403 });
  }

  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    return new Response(fs.readFileSync(path.join(publicDir, 'index.html')), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  const ext = path.extname(candidate);
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };

  return new Response(fs.readFileSync(candidate), {
    headers: { 'Content-Type': types[ext] ?? 'application/octet-stream' },
  });
}

export async function runApiServer(port?: number, existingStore?: MindStore): Promise<void> {
  const httpPort = port ?? Number(process.env.PORT ?? 3000);

  if (!existingStore) {
    if (!fs.existsSync(CONFIG.dataDir)) {
      fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    }
  }

  const store = existingStore ?? createSqliteStore(CONFIG.dbPath);

  Bun.serve({
    port: httpPort,
    async fetch(req) {
      try {
        const matched = await matchApiRoute(req, store);
        if (matched) return matched;

        const url = new URL(req.url);
        return resolveStaticFile(url.pathname);
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    },
  });

  console.log(`mind web running at http://localhost:${httpPort}`);
  await new Promise(() => {});
}
