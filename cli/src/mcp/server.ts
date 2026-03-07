import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { MindStore } from '../store/mind-store';
import { createSpaceTools } from './tools/spaces';
import { createMemoryTools } from './tools/memories';
import { createTierTools } from './tools/tiers';
import { createLinkTools } from './tools/links';
import { createSearchTools } from './tools/search';

const MEMORY_PROTOCOL_INSTRUCTIONS = `
## Mind Memory Protocol

### CONVENCIONES DE TAGS (obligatorio)

Antes de crear un nuevo tag, SIEMPRE listar los tags existentes en el space
y verificar si ya existe uno semánticamente equivalente.

Tags con prefijo obligatorio:
- type:project   — espacio de proyecto de código
- type:user      — preferencias/configuración del usuario
- type:config    — configuración global cross-project
- type:learning  — conocimiento aprendido
- type:session   — resúmenes de sesión

- cat:decision   — decisión arquitectónica
- cat:bugfix     — bug arreglado
- cat:pattern    — patrón establecido
- cat:discovery  — hallazgo técnico
- cat:preference — preferencia del usuario
- cat:config     — configuración específica

### ESTRUCTURA DE SPACES

Organizar en espacios jerárquicos:
- projects/<nombre>     — un space por proyecto
- user/preferences      — preferencias globales
- user/patterns         — patrones de trabajo
- global/config         — config cross-project
- sessions/<proyecto>   — resúmenes de sesión

### CUÁNDO GUARDAR (mandatorio)

Llamar memory_add INMEDIATAMENTE después de:
- Bug fix completado
- Decisión de arquitectura tomada
- Hallazgo técnico no-obvio
- Cambio de configuración o ambiente
- Patrón establecido (naming, estructura, convención)
- Preferencia del usuario aprendida

Formato del content:
**What**: Una oración — qué se hizo
**Why**: Qué lo motivó (request usuario, bug, performance, etc.)
**Where**: Archivos o paths afectados
**Learned**: Gotchas, edge cases, decisiones (omitir si no hay)

### TIER SYSTEM (CPU-cache style)

Usar tiers para prioridad:
- T1 (hot)     — info crítica activa (decisiones, preferencias)
- T2 (warm)    — default para memorias nuevas
- T3 (cold)    — info de referencia (hallazgos, bugs pasados)
- T4 (frozen)  — archivo, solo accesible vía search

Auto-promote: leer una memoria la sube un tier.
Pin: memorias fijadas no se mueven de tier.

### LINKS

Conectar memorias relacionadas:
- Decisión → Bug que la motivó
- Preferencia → Proyectos afectados
- Patrón → Ejemplos de uso

### CIERRE DE SESIÓN (mandatorio)

Antes de terminar una sesión, llamar memory_add con:
- space: sessions/<proyecto>
- tags: [type:session, cat:summary]
- content con estructura:

## Goal
[En qué estábamos trabajando]

## Discoveries
- [Hallazgos técnicos]

## Accomplished
- ✅ [Tareas completadas]
- 🔲 [Tareas pendientes]

## Relevant Files
- path/to/file — [qué hace o qué cambió]
`;

type ToolDefinition = {
  schema: any;
  handler: (args: any) => Promise<any>;
};

function createMcpServer(store: MindStore): Server {
  const server = new Server(
    {
      name: 'mind-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const allTools: Record<string, ToolDefinition> = {
    ...createSpaceTools(store),
    ...createMemoryTools(store),
    ...createTierTools(store),
    ...createLinkTools(store),
    ...createSearchTools(store),
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Object.entries(allTools).map(([name, tool]) => ({
        name,
        description: `${MEMORY_PROTOCOL_INSTRUCTIONS}\n\nTool: ${name}`,
        inputSchema: tool.schema ? zodToJsonSchema(tool.schema) : { type: 'object', properties: {} },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = allTools[name];

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      const result = await tool.handler(args);
      const structuredContent = result?.structuredContent
        ?? (result && typeof result === 'object'
          ? Object.fromEntries(
              Object.entries(result).filter(([k]) => k !== 'content' && k !== 'isError' && k !== 'meta')
            )
          : undefined);

      return {
        content: result.content ?? [{ type: 'text', text: 'OK' }],
        ...(structuredContent && Object.keys(structuredContent).length > 0
          ? { structuredContent }
          : {}),
        isError: false,
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

function zodToJsonSchema(schema: any): any {
  if (schema?._def?.typeName === 'ZodObject') {
    const properties: any = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(schema.shape)) {
      const zodValue = value as any;
      properties[key] = zodTypeToJson(zodValue);
      if (!zodValue.isOptional?.()) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return { type: 'object' };
}

function zodTypeToJson(zodType: any): any {
  const typeName = zodType?._def?.typeName;

  switch (typeName) {
    case 'ZodString':
      return { type: 'string', description: zodType.description };
    case 'ZodNumber':
      return { type: 'number', description: zodType.description };
    case 'ZodBoolean':
      return { type: 'boolean', description: zodType.description };
    case 'ZodArray':
      return {
        type: 'array',
        items: zodTypeToJson(zodType._def.type),
        description: zodType.description,
      };
    case 'ZodOptional':
      return {
        ...zodTypeToJson(zodType._def.innerType),
        description: zodType.description,
      };
    default:
      return { type: 'string', description: zodType?.description };
  }
}

export async function startMcpServer(store: MindStore): Promise<void> {
  const server = createMcpServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mind MCP server running on stdio');
}

type SessionEntry = {
  server: Server;
  transport: WebStandardStreamableHTTPServerTransport;
};

function jsonRpcSessionError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message },
      id: null,
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export async function startMcpHttpServer(store: MindStore, port: number = 7438): Promise<void> {
  const sessions = new Map<string, SessionEntry>();
  const mcpPort = Number(port || process.env.MCP_PORT || 7438);
  const idleTimeout = Number(process.env.MIND_MCP_IDLE_TIMEOUT ?? 120);

  Bun.serve({
    port: mcpPort,
    idleTimeout,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (url.pathname === '/health' && req.method === 'GET') {
        return new Response(JSON.stringify({ status: 'ok', service: 'mind-mcp', version: '1.0.0' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname !== '/mcp') {
        return new Response('Not Found', { status: 404 });
      }

      if (req.method === 'POST') {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return jsonRpcSessionError(400, 'Invalid JSON body');
        }

        const sessionId = req.headers.get('mcp-session-id') ?? undefined;

        if (sessionId && sessions.has(sessionId)) {
          const current = sessions.get(sessionId)!;
          return current.transport.handleRequest(req, { parsedBody: body });
        }

        if (!sessionId && isInitializeRequest(body)) {
          const server = createMcpServer(store);
          let transport: WebStandardStreamableHTTPServerTransport;

          transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions.set(id, { server, transport });
            },
          });

          transport.onclose = () => {
            const id = transport.sessionId;
            if (id) {
              sessions.delete(id);
            }
            server.close().catch(() => {});
          };

          await server.connect(transport);
          return transport.handleRequest(req, { parsedBody: body });
        }

        return jsonRpcSessionError(400, 'Invalid or missing MCP session');
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        const sessionId = req.headers.get('mcp-session-id') ?? undefined;
        if (!sessionId || !sessions.has(sessionId)) {
          return jsonRpcSessionError(400, 'Invalid or missing MCP session');
        }
        const current = sessions.get(sessionId)!;
        return current.transport.handleRequest(req);
      }

      return jsonRpcSessionError(405, 'Method not allowed');
    },
  });

  console.error(`Mind MCP HTTP server running on http://localhost:${mcpPort}/mcp`);
}
