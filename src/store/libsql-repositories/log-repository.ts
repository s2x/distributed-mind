// ── libSQL LogRepository: handles all log operations + SSE pub/sub ──

import type { Client } from '@libsql/client';

export interface LogEntryInput {
  source: 'cli' | 'mcp' | 'api';
  operation: string;
  level?: 'info' | 'warn' | 'error';
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  errorMessage?: string;
  callerInfo?: Record<string, unknown>;
  durationMs?: number;
}

export interface LogRepository {
  addLog(entry: LogEntryInput): Promise<void>;
  queryLogs(filter?: {
    source?: string;
    operation?: string;
    search?: string;
    from?: string;
    to?: string;
    level?: 'info' | 'warn' | 'error';
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
    since?: number;
  }): Promise<{ logs: any[]; total: number; limit: number; offset: number }>;
  cleanupOldLogs(retentionMinutes: number): Promise<number>;
  clearAllLogs(): Promise<number>;
}

// ── SSE Pub/Sub for real-time logs ──
type SseController = {
  enqueue: (_data: string) => void;
  close: () => void;
};

const logSubscribers = new Map<string, { controller: SseController; filter?: string }>();

export function subscribeToLogs(
  sessionId: string,
  controller: SseController,
  filter?: string
): void {
  logSubscribers.set(sessionId, { controller, filter });
}

export function unsubscribeFromLogs(sessionId: string): void {
  const sub = logSubscribers.get(sessionId);
  if (sub) {
    sub.controller.close();
    logSubscribers.delete(sessionId);
  }
}

function notifyLogSubscribers(logEntry: any): void {
  for (const [sessionId, sub] of logSubscribers) {
    try {
      // Apply filter if set (supports comma-separated multiple sources)
      if (sub.filter) {
        const filters = sub.filter.split(',').map((s: string) => s.trim().toLowerCase());
        if (!filters.includes(logEntry.source.toLowerCase())) {
          continue;
        }
      }
      const data = `data: ${JSON.stringify(logEntry)}\n\n`;
      sub.controller.enqueue(data);
    } catch {
      // Client disconnected, remove
      logSubscribers.delete(sessionId);
    }
  }
}

const MAX_LOG_FIELD_SIZE = 65536; // 64KB truncation limit

function truncateLogField(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return str.length > MAX_LOG_FIELD_SIZE ? str.slice(0, MAX_LOG_FIELD_SIZE) : str;
}

export function createLibsqlLogRepository(client: Client): LogRepository {
  let lastLogId = 0;

  async function addLog(entry: LogEntryInput): Promise<void> {
    try {
      // Fire-and-forget: don't await, don't block
      const timestamp = new Date().toISOString();
      const result = await client.execute({
        sql: `INSERT INTO logs (source, operation, level, input_data, output_data, error_message, caller_info, duration_ms, timestamp)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          entry.source,
          entry.operation,
          entry.level ?? 'info',
          truncateLogField(entry.inputData),
          truncateLogField(entry.outputData),
          truncateLogField(entry.errorMessage),
          truncateLogField(entry.callerInfo),
          entry.durationMs ?? null,
          timestamp,
        ],
      });

      // Get the last inserted ID (BigInt → convert to number)
      lastLogId = Number(result.lastInsertRowid);

      // Fetch the inserted log entry and notify SSE subscribers (non-blocking)
      const logEntryResult = await client.execute({
        sql: 'SELECT * FROM logs WHERE id = ?',
        args: [lastLogId],
      });

      if (logEntryResult.rows.length > 0) {
        const logEntry = logEntryResult.rows[0];
        notifyLogSubscribers(logEntry);
      }
    } catch {
      // Non-blocking: logging failures must not affect operations
    }
  }

  async function queryLogs(filter?: {
    source?: string;
    operation?: string;
    search?: string;
    from?: string;
    to?: string;
    level?: 'info' | 'warn' | 'error';
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
    since?: number;
  }): Promise<{ logs: any[]; total: number; limit: number; offset: number }> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.source) {
      const sources = filter.source.split(',').map(s => s.trim().toLowerCase());
      conditions.push(`source IN (${sources.map(() => '?').join(',')})`);
      params.push(...sources);
    }

    if (filter?.operation) {
      conditions.push('operation = ?');
      params.push(filter.operation);
    }

    if (filter?.search) {
      const searchTerm = `%${filter.search}%`;
      conditions.push(
        '(operation LIKE ? OR input_data LIKE ? OR output_data LIKE ? OR error_message LIKE ?)'
      );
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (filter?.from) {
      conditions.push('timestamp >= ?');
      params.push(filter.from);
    }

    if (filter?.to) {
      conditions.push('timestamp <= ?');
      params.push(filter.to);
    }

    if (filter?.level) {
      conditions.push('level = ?');
      params.push(filter.level);
    }

    if (filter?.since !== undefined) {
      conditions.push('id > ?');
      params.push(filter.since);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await client.execute({
      sql: `SELECT COUNT(*) as total FROM logs ${whereClause}`,
      args: params,
    });

    const total = (countResult.rows[0] as { total: number })?.total || 0;

    const limit = Math.max(1, Math.min(500, filter?.limit ?? 100));
    const offset = Math.max(0, filter?.offset ?? 0);
    const order = filter?.order === 'asc' ? 'ASC' : 'DESC';

    const logsResult = await client.execute({
      sql: `SELECT * FROM logs ${whereClause} ORDER BY timestamp ${order} LIMIT ? OFFSET ?`,
      args: [...params, limit, offset],
    });

    return {
      logs: logsResult.rows.map(r => ({
        id: r.id,
        source: r.source,
        operation: r.operation,
        level: r.level,
        input_data: r.input_data,
        output_data: r.output_data,
        error_message: r.error_message,
        caller_info: r.caller_info,
        duration_ms: r.duration_ms,
        timestamp: r.timestamp,
      })),
      total,
      limit,
      offset,
    };
  }

  async function cleanupOldLogs(retentionMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionMinutes * 60 * 1000).toISOString();
    const result = await client.execute({
      sql: 'DELETE FROM logs WHERE timestamp < ?',
      args: [cutoff],
    });
    // libSQL returns changes as a number in the result
    return typeof result.changes === 'number' ? result.changes : 0;
  }

  async function clearAllLogs(): Promise<number> {
    const result = await client.execute('DELETE FROM logs');
    return typeof result.changes === 'number' ? result.changes : 0;
  }

  return {
    addLog,
    queryLogs,
    cleanupOldLogs,
    clearAllLogs,
  };
}
