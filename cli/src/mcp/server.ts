import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import type { MindStore } from '../store/mind-store';
import { createCheckpointTools } from './tools/checkpoint';
import { createLinkTools } from './tools/links';
import { createMemoryTools } from './tools/memories';
import { createSearchTools } from './tools/search';
import { createSpaceTools } from './tools/spaces';
import { createSystemTools } from './tools/system';
import { createTierTools } from './tools/tiers';

type ToolAnnotations = {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
};

type ToolDefinition = {
    description?: string;
    schema: any;
    annotations?: ToolAnnotations;
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
        ...createCheckpointTools(store),
        ...createSystemTools(),
    };

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: Object.entries(allTools).map(([name, tool]) => ({
                name,
                description: tool.description
                    ? `${tool.description}\n\nSee system_instructions for full mind usage guidelines.`
                    : `Call system_instructions first to get full mind usage guidelines.\n\nTool: ${name}`,
                inputSchema: tool.schema ? zodToJsonSchema(tool.schema) : { type: 'object', properties: {} },
                annotations: tool.annotations,
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
            const structuredContent =
                result?.structuredContent ??
                (result && typeof result === 'object'
                    ? Object.fromEntries(
                          Object.entries(result).filter(([k]) => k !== 'content' && k !== 'isError' && k !== 'meta')
                      )
                    : undefined);

            return {
                content: result.content ?? [{ type: 'text', text: 'OK' }],
                ...(structuredContent && Object.keys(structuredContent).length > 0 ? { structuredContent } : {}),
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

// Zod 4.x to JSON Schema conversion
function zodToJsonSchema(schema: any): any {
    if (!schema || !schema._def) {
        return { type: 'object', properties: {} };
    }

    const def = schema._def;

    // Handle ZodObject
    if (def.type === 'object') {
        const shape = def.shape || {};
        const properties: any = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape as Record<string, unknown>)) {
            if (!value || typeof value !== 'object' || !('_def' in value)) {
                properties[key] = { type: 'string' };
                required.push(key);
                continue;
            }

            const fieldSchema = value as { _def: any; description?: string };
            const fieldDef = fieldSchema._def;
            const fieldType = fieldDef.type;
            const fieldDescription = fieldSchema.description;

            if (fieldType === 'string') {
                properties[key] = { type: 'string' };
                if (fieldDescription) properties[key].description = fieldDescription;
                required.push(key);
            } else if (fieldType === 'number') {
                properties[key] = { type: 'number' };
                if (fieldDescription) properties[key].description = fieldDescription;
                required.push(key);
            } else if (fieldType === 'boolean') {
                properties[key] = { type: 'boolean' };
                if (fieldDescription) properties[key].description = fieldDescription;
                required.push(key);
            } else if (fieldType === 'optional') {
                const innerDef = fieldDef.innerType?._def;
                if (innerDef?.type === 'string') {
                    properties[key] = { type: 'string' };
                } else if (innerDef?.type === 'number') {
                    properties[key] = { type: 'number' };
                } else if (innerDef?.type === 'boolean') {
                    properties[key] = { type: 'boolean' };
                } else if (innerDef?.type === 'array') {
                    properties[key] = { type: 'array', items: { type: 'string' } };
                } else {
                    properties[key] = { type: 'string' };
                }
                if (fieldDescription) properties[key].description = fieldDescription;
            } else if (fieldType === 'array') {
                properties[key] = { type: 'array', items: { type: 'string' } };
                if (fieldDescription) properties[key].description = fieldDescription;
                required.push(key);
            } else if (fieldType === 'enum') {
                properties[key] = { type: 'string', enum: fieldDef.values };
                if (fieldDescription) properties[key].description = fieldDescription;
                required.push(key);
            } else {
                properties[key] = { type: 'string' };
                if (fieldDescription) properties[key].description = fieldDescription;
                required.push(key);
            }
        }

        return {
            type: 'object',
            properties,
            required: required.length > 0 ? required : undefined,
        };
    }

    return { type: 'object', properties: {} };
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
