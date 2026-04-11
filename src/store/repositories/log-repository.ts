// ── LogRepository: handles all log operations + SSE pub/sub ──

import type { Database } from 'bun:sqlite';

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
  addLog(entry: LogEntryInput): void;
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
  }): { logs: any[]; total: number; limit: number; offset: number };
  cleanupOldLogs(retentionMinutes: number): number;
  clearAllLogs(): number;
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
      // Pass the string, not bytes - let the subscriber handle encoding
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

export function createLogRepository(db: Database): LogRepository {
  let lastLogId = 0;

  function addLog(entry: LogEntryInput): void {
    try {
      // Fire-and-forget: don't await, don't block
      db.run(
        `INSERT INTO logs (source, operation, level, input_data, output_data, error_message, caller_info, duration_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.source,
          entry.operation,
          entry.level ?? 'info',
          truncateLogField(entry.inputData),
          truncateLogField(entry.outputData),
          truncateLogField(entry.errorMessage),
          truncateLogField(entry.callerInfo),
          entry.durationMs ?? null,
        ]
      );

      // Get the last inserted ID
      const lastRow = db.query('SELECT last_insert_rowid() as id').get() as { id: number };
      lastLogId = lastRow.id;

      // Notify SSE subscribers (non-blocking)
      const logEntry = db.query('SELECT * FROM logs WHERE id = ?').get(lastLogId);
      if (logEntry) {
        notifyLogSubscribers(logEntry);
      }
    } catch {
      // Non-blocking: logging failures must not affect operations
    }
  }

  function queryLogs(filter?: {
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
  }): { logs: any[]; total: number; limit: number; offset: number } {
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
    const countRow = db
      .query(`SELECT COUNT(*) as total FROM logs ${whereClause}`)
      .get(...params) as {
      total: number;
    };
    const total = countRow.total;

    const limit = Math.max(1, Math.min(500, filter?.limit ?? 100));
    const offset = Math.max(0, filter?.offset ?? 0);
    const order = filter?.order === 'asc' ? 'ASC' : 'DESC';

    const rows = db
      .query(`SELECT * FROM logs ${whereClause} ORDER BY timestamp ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as any[];

    return {
      logs: rows.map(r => ({
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

  function cleanupOldLogs(retentionMinutes: number): number {
    const cutoff = new Date(Date.now() - retentionMinutes * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .split('.')[0]!;
    const result = db.run('DELETE FROM logs WHERE timestamp < ?', [cutoff]);
    return result.changes;
  }

  function clearAllLogs(): number {
    const result = db.run('DELETE FROM logs');
    return result.changes;
  }

  return {
    addLog,
    queryLogs,
    cleanupOldLogs,
    clearAllLogs,
  };
}
