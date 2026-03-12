import type { RouteDefinition, RouteContext } from './types';

export const logRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        match: (pathname: string) => {
            if (pathname === '/api/logs' || pathname === '/api/logs/') return {};
            return null;
        },
        handle: async (ctx: RouteContext) => {
            const { store, url, json, err } = ctx;

            const source = url.searchParams.get('source') ?? undefined;
            const operation = url.searchParams.get('operation') ?? undefined;
            const search = url.searchParams.get('search') ?? undefined;
            const from = url.searchParams.get('from') ?? undefined;
            const to = url.searchParams.get('to') ?? undefined;
            const level = url.searchParams.get('level') as 'info' | 'warn' | 'error' | undefined;
            const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;
            const offset = url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!, 10) : undefined;
            const order = url.searchParams.get('order') as 'asc' | 'desc' | undefined;
            const since = url.searchParams.get('since') ? parseInt(url.searchParams.get('since')!, 10) : undefined;

            try {
                const result = store.queryLogs({
                    source,
                    operation,
                    search,
                    from,
                    to,
                    level,
                    limit,
                    offset,
                    order,
                    since,
                });
                return json(result);
            } catch (e: any) {
                return err(e.message);
            }
        },
    },
    {
        method: 'GET',
        match: (pathname: string) => {
            const match = pathname.match(/^\/api\/logs\/stream\/?$/);
            return match ? {} : null;
        },
        handle: async (ctx: RouteContext) => {
            const { store, url } = ctx;

            const source = url.searchParams.get('source') ?? undefined;
            const lastId = url.searchParams.get('lastId') ? parseInt(url.searchParams.get('lastId')!, 10) : 0;

            // Generate unique session ID
            const sessionId = `log_${Date.now()}_${Math.random().toString(36).slice(2)}`;

            // Reference to the heartbeat interval for cleanup
            let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

            // Create a streaming response with proper SSE
            const stream = new ReadableStream({
                start(controller) {
                    // Send initial comments to establish connection
                    controller.enqueue(new TextEncoder().encode(': connected\n\n'));

                    // Get initial logs after lastId
                    const initialResult = store.queryLogs({
                        source,
                        limit: 100,
                        offset: 0,
                        order: 'desc',
                    });

                    // Filter out logs with id <= lastId
                    const filteredLogs = initialResult.logs.filter((log) => log.id > lastId);

                    // Send initial logs
                    for (const log of filteredLogs) {
                        const data = `data: ${JSON.stringify(log)}\n\n`;
                        controller.enqueue(new TextEncoder().encode(data));
                    }

                    // Subscribe to new logs
                    store.subscribeToLogs(sessionId, {
                        enqueue: (data: string) => {
                            try {
                                controller.enqueue(new TextEncoder().encode(data));
                            } catch {
                                // Controller closed, clear heartbeat and unsubscribe
                                if (heartbeatInterval) {
                                    clearInterval(heartbeatInterval);
                                    heartbeatInterval = null;
                                }
                                store.unsubscribeFromLogs(sessionId);
                            }
                        },
                        close: () => {
                            if (heartbeatInterval) {
                                clearInterval(heartbeatInterval);
                                heartbeatInterval = null;
                            }
                            store.unsubscribeFromLogs(sessionId);
                        },
                    }, source);

                    // Add heartbeat to keep connection alive
                    heartbeatInterval = setInterval(() => {
                        try {
                            controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
                        } catch {
                            // Controller closed, clear interval
                            if (heartbeatInterval) {
                                clearInterval(heartbeatInterval);
                                heartbeatInterval = null;
                            }
                            store.unsubscribeFromLogs(sessionId);
                        }
                    }, 30000);
                },
                cancel() {
                    // Clean up heartbeat interval
                    if (heartbeatInterval) {
                        clearInterval(heartbeatInterval);
                        heartbeatInterval = null;
                    }
                    store.unsubscribeFromLogs(sessionId);
                },
            });

            // Return SSE response
            return new Response(stream, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no',
                },
            });
        },
    },
];
