/**
 * Event/Action/Tool logging for NanoClaw.
 * All logging is fire-and-forget — never blocks the main pipeline.
 */
import crypto from 'crypto';

import Database from 'better-sqlite3';
import {
  EVENT_LOG_PRUNE_INTERVAL,
  EVENT_LOG_RETENTION_DAYS,
  TIMEZONE,
} from './config.js';
import { getDb } from './db.js';
import { logger } from './logger.js';

const MAX_CONTENT_SIZE = 10 * 1024; // 10KB

function truncate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str.length > MAX_CONTENT_SIZE) return str.slice(0, MAX_CONTENT_SIZE);
  return str;
}

// Prepared statements (lazily created)
let _insertEvent: Database.Statement | null = null;
let _insertAction: Database.Statement | null = null;
let _insertToolCall: Database.Statement | null = null;

function insertEventStmt(): Database.Statement {
  if (!_insertEvent) {
    _insertEvent = getDb().prepare(
      `INSERT INTO event_log (id, timestamp, source, source_id, raw_content, summary) VALUES (?, ?, ?, ?, ?, ?)`,
    );
  }
  return _insertEvent;
}

function insertActionStmt(): Database.Statement {
  if (!_insertAction) {
    _insertAction = getDb().prepare(
      `INSERT INTO action_log (id, timestamp, triggered_by, action_type, target, content, tool_calls) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
  }
  return _insertAction;
}

function insertToolCallStmt(): Database.Statement {
  if (!_insertToolCall) {
    _insertToolCall = getDb().prepare(
      `INSERT INTO tool_call_log (id, action_id, timestamp, tool_name, input, output, duration_ms, success) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }
  return _insertToolCall;
}

/**
 * Log an inbound event (message received, task triggered, IPC action, etc.)
 * Returns the event ID for correlation with downstream actions.
 */
export function logEvent(
  source: string,
  sourceId: string | null,
  rawContent: unknown,
  summary: string,
): string {
  const id = crypto.randomUUID();
  try {
    insertEventStmt().run(
      id,
      new Date().toISOString(),
      source,
      sourceId,
      truncate(rawContent),
      summary,
    );
  } catch (err) {
    logger.debug({ err, source, sourceId }, 'Failed to log event');
  }
  return id;
}

/**
 * Log an action taken in response to an event (message sent, task scheduled, etc.)
 * Returns the action ID for correlation with tool calls.
 */
export function logAction(
  triggeredBy: string | null,
  actionType: string,
  target: string | null,
  content: unknown,
  toolCalls?: string[],
): string {
  const id = crypto.randomUUID();
  try {
    insertActionStmt().run(
      id,
      new Date().toISOString(),
      triggeredBy,
      actionType,
      target,
      truncate(content),
      toolCalls ? JSON.stringify(toolCalls) : null,
    );
  } catch (err) {
    logger.debug({ err, actionType, target }, 'Failed to log action');
  }
  return id;
}

/**
 * Wrap an async operation, recording input/output/duration/success.
 * Returns the result of the wrapped function.
 */
export async function logToolCall<T>(
  actionId: string,
  toolName: string,
  input: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const id = crypto.randomUUID();
  const start = Date.now();
  let success = true;
  let output: unknown = null;

  try {
    const result = await fn();
    output = result;
    return result;
  } catch (err) {
    success = false;
    output = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const durationMs = Date.now() - start;
    try {
      insertToolCallStmt().run(
        id,
        actionId,
        new Date().toISOString(),
        toolName,
        truncate(input),
        truncate(output),
        durationMs,
        success ? 1 : 0,
      );
    } catch (logErr) {
      logger.debug(
        { err: logErr, toolName, actionId },
        'Failed to log tool call',
      );
    }
  }
}

// --- Query functions for /debug command ---

export interface EventLogRow {
  id: string;
  timestamp: string;
  source: string;
  source_id: string | null;
  raw_content: string | null;
  summary: string | null;
}

export interface ActionLogRow {
  id: string;
  timestamp: string;
  triggered_by: string | null;
  action_type: string;
  target: string | null;
  content: string | null;
  tool_calls: string | null;
}

export interface ToolCallLogRow {
  id: string;
  action_id: string;
  timestamp: string;
  tool_name: string;
  input: string | null;
  output: string | null;
  duration_ms: number;
  success: number;
}

/**
 * Get last N actions with their triggering events.
 */
export function getLastActions(n: number): Array<{
  action: ActionLogRow;
  event: EventLogRow | null;
}> {
  const rows = getDb()
    .prepare(
      `SELECT a.*, e.id as e_id, e.timestamp as e_timestamp, e.source as e_source,
              e.source_id as e_source_id, e.summary as e_summary
       FROM action_log a
       LEFT JOIN event_log e ON a.triggered_by = e.id
       ORDER BY a.timestamp DESC
       LIMIT ?`,
    )
    .all(n) as Array<
    ActionLogRow & {
      e_id: string | null;
      e_timestamp: string | null;
      e_source: string | null;
      e_source_id: string | null;
      e_summary: string | null;
    }
  >;

  return rows.map((r) => ({
    action: {
      id: r.id,
      timestamp: r.timestamp,
      triggered_by: r.triggered_by,
      action_type: r.action_type,
      target: r.target,
      content: r.content,
      tool_calls: r.tool_calls,
    },
    event: r.e_id
      ? {
          id: r.e_id,
          timestamp: r.e_timestamp!,
          source: r.e_source!,
          source_id: r.e_source_id,
          raw_content: null,
          summary: r.e_summary,
        }
      : null,
  }));
}

/**
 * Get the most recent action with full tool call chain.
 */
export function getLastActionWithToolCalls(): {
  action: ActionLogRow;
  event: EventLogRow | null;
  toolCalls: ToolCallLogRow[];
} | null {
  const results = getLastActions(1);
  if (results.length === 0) return null;

  const { action, event } = results[0];
  const toolCalls = getDb()
    .prepare(
      `SELECT * FROM tool_call_log WHERE action_id = ? ORDER BY timestamp`,
    )
    .all(action.id) as ToolCallLogRow[];

  return { action, event, toolCalls };
}

/**
 * Get all actions triggered by a specific event.
 */
export function getActionsForEvent(eventId: string): {
  event: EventLogRow | null;
  actions: Array<{ action: ActionLogRow; toolCalls: ToolCallLogRow[] }>;
} {
  const event = getDb()
    .prepare(`SELECT * FROM event_log WHERE id = ?`)
    .get(eventId) as EventLogRow | undefined;

  const actions = getDb()
    .prepare(
      `SELECT * FROM action_log WHERE triggered_by = ? ORDER BY timestamp`,
    )
    .all(eventId) as ActionLogRow[];

  return {
    event: event || null,
    actions: actions.map((action) => ({
      action,
      toolCalls: getDb()
        .prepare(
          `SELECT * FROM tool_call_log WHERE action_id = ? ORDER BY timestamp`,
        )
        .all(action.id) as ToolCallLogRow[],
    })),
  };
}

// --- Retention / pruning ---

/**
 * Delete log rows older than the retention period.
 * Deletes in order: tool_call_log → action_log → event_log (FK safety).
 * Returns counts of deleted rows.
 */
export function pruneOldLogs(): {
  events: number;
  actions: number;
  toolCalls: number;
} {
  if (EVENT_LOG_RETENTION_DAYS === 0) {
    return { events: 0, actions: 0, toolCalls: 0 };
  }

  const cutoff = new Date(
    Date.now() - EVENT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  try {
    const db = getDb();

    // tool_call_log: delete by joining through action_log
    const tcResult = db
      .prepare(
        `DELETE FROM tool_call_log WHERE action_id IN (
          SELECT id FROM action_log WHERE timestamp < ?
        )`,
      )
      .run(cutoff);

    const aResult = db
      .prepare(`DELETE FROM action_log WHERE timestamp < ?`)
      .run(cutoff);

    const eResult = db
      .prepare(`DELETE FROM event_log WHERE timestamp < ?`)
      .run(cutoff);

    const counts = {
      events: eResult.changes,
      actions: aResult.changes,
      toolCalls: tcResult.changes,
    };

    if (counts.events > 0 || counts.actions > 0 || counts.toolCalls > 0) {
      logger.info(
        { ...counts, retentionDays: EVENT_LOG_RETENTION_DAYS },
        'Pruned old event logs',
      );
    }

    return counts;
  } catch (err) {
    logger.warn({ err }, 'Failed to prune event logs');
    return { events: 0, actions: 0, toolCalls: 0 };
  }
}

let _pruneTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic log pruning. Safe to call multiple times (idempotent).
 * Runs an initial prune immediately, then on EVENT_LOG_PRUNE_INTERVAL.
 */
export function startLogPruning(): void {
  if (_pruneTimer) return;
  pruneOldLogs();
  _pruneTimer = setInterval(pruneOldLogs, EVENT_LOG_PRUNE_INTERVAL);
  // Don't keep the process alive just for pruning
  _pruneTimer.unref();
}

// --- Report ---

export interface LogReport {
  retentionDays: number;
  period: { from: string; to: string };
  tableSizes: { events: number; actions: number; toolCalls: number };
  eventsBySource: Array<{ source: string; count: number }>;
  actionsByType: Array<{ action_type: string; count: number }>;
  failedToolCalls: Array<{
    tool_name: string;
    action_id: string;
    timestamp: string;
    duration_ms: number;
    output: string | null;
  }>;
  busiestHours: Array<{ hour: string; count: number }>;
  recentErrors: Array<{
    timestamp: string;
    action_type: string;
    target: string | null;
    content: string | null;
    event_summary: string | null;
  }>;
}

/**
 * Build a summary report of the event logs for debugging.
 */
export function buildLogReport(): LogReport {
  const db = getDb();
  const now = new Date();
  const retentionMs = EVENT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const from =
    EVENT_LOG_RETENTION_DAYS > 0
      ? new Date(now.getTime() - retentionMs).toISOString()
      : '1970-01-01T00:00:00.000Z';

  const eventCount = (
    db.prepare(`SELECT COUNT(*) as c FROM event_log`).get() as { c: number }
  ).c;
  const actionCount = (
    db.prepare(`SELECT COUNT(*) as c FROM action_log`).get() as { c: number }
  ).c;
  const toolCallCount = (
    db.prepare(`SELECT COUNT(*) as c FROM tool_call_log`).get() as {
      c: number;
    }
  ).c;

  const eventsBySource = db
    .prepare(
      `SELECT source, COUNT(*) as count FROM event_log GROUP BY source ORDER BY count DESC`,
    )
    .all() as Array<{ source: string; count: number }>;

  const actionsByType = db
    .prepare(
      `SELECT action_type, COUNT(*) as count FROM action_log GROUP BY action_type ORDER BY count DESC`,
    )
    .all() as Array<{ action_type: string; count: number }>;

  const failedToolCalls = db
    .prepare(
      `SELECT tool_name, action_id, timestamp, duration_ms, output
       FROM tool_call_log WHERE success = 0
       ORDER BY timestamp DESC LIMIT 10`,
    )
    .all() as LogReport['failedToolCalls'];

  // Busiest hours — bucket by local hour using the configured timezone
  const allTimestamps = db
    .prepare(`SELECT timestamp FROM event_log`)
    .all() as Array<{ timestamp: string }>;

  const hourCounts = new Map<string, number>();
  for (const { timestamp } of allTimestamps) {
    const localHour = new Date(timestamp).toLocaleString('en-US', {
      timeZone: TIMEZONE,
      hour: 'numeric',
      hour12: true,
    });
    hourCounts.set(localHour, (hourCounts.get(localHour) || 0) + 1);
  }
  const busiestHours = Array.from(hourCounts.entries())
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 24);

  // Recent error actions (actions where content suggests an error)
  const recentErrors = db
    .prepare(
      `SELECT a.timestamp, a.action_type, a.target, a.content, e.summary as event_summary
       FROM action_log a
       LEFT JOIN event_log e ON a.triggered_by = e.id
       WHERE a.action_type LIKE '%error%'
          OR a.content LIKE '%error%'
          OR a.content LIKE '%Error%'
          OR a.content LIKE '%failed%'
       ORDER BY a.timestamp DESC LIMIT 10`,
    )
    .all() as LogReport['recentErrors'];

  return {
    retentionDays: EVENT_LOG_RETENTION_DAYS,
    period: { from, to: now.toISOString() },
    tableSizes: {
      events: eventCount,
      actions: actionCount,
      toolCalls: toolCallCount,
    },
    eventsBySource,
    actionsByType,
    failedToolCalls,
    busiestHours,
    recentErrors,
  };
}
