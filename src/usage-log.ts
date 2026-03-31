/**
 * Usage tracking for NanoClaw agent invocations.
 * Logs token counts, cost, and duration per query.
 * All logging is fire-and-forget - never blocks the main pipeline.
 */
import crypto from 'crypto';

import { getDb } from './db.js';
import { logger } from './logger.js';
import type { UsageData } from './container-runner.js';
import {
  startOfLocalDayUtcString,
  sqliteUtcOffsetModifier,
} from './timezone.js';

let _schemaInitialized = false;

function ensureSchema(): void {
  if (_schemaInitialized) return;
  _schemaInitialized = true;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS usage_log (
      id                    TEXT PRIMARY KEY,
      timestamp             DATETIME DEFAULT CURRENT_TIMESTAMP,
      group_jid             TEXT NOT NULL,
      group_name            TEXT NOT NULL,
      group_folder          TEXT NOT NULL,
      input_tokens          INTEGER NOT NULL DEFAULT 0,
      output_tokens         INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd              REAL NOT NULL DEFAULT 0,
      duration_ms           INTEGER NOT NULL DEFAULT 0,
      num_turns             INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_usage_log_timestamp ON usage_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_log_group ON usage_log(group_jid);
  `);
}

export function logUsage(
  groupJid: string,
  groupName: string,
  groupFolder: string,
  usage: UsageData,
): void {
  try {
    ensureSchema();
    getDb()
      .prepare(
        `INSERT INTO usage_log
         (id, group_jid, group_name, group_folder,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          cost_usd, duration_ms, num_turns)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        groupJid,
        groupName,
        groupFolder,
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_input_tokens,
        usage.cache_creation_input_tokens,
        usage.cost_usd,
        usage.duration_ms,
        usage.num_turns,
      );
  } catch (err) {
    logger.warn({ err }, 'Failed to log usage');
  }
}

interface UsageSummary {
  invocations: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_cost_usd: number;
  total_duration_ms: number;
  total_turns: number;
}

interface GroupUsage extends UsageSummary {
  group_name: string;
  group_folder: string;
}

interface DailyUsage extends UsageSummary {
  date: string;
}

function periodFilter(
  period: 'today' | 'week' | 'month' | 'all',
  timezone = 'UTC',
): string {
  switch (period) {
    case 'today':
      return `WHERE timestamp >= '${startOfLocalDayUtcString(timezone)}'`;
    case 'week':
      return "WHERE timestamp >= datetime('now', '-7 days')";
    case 'month':
      return "WHERE timestamp >= datetime('now', '-30 days')";
    case 'all':
      return '';
  }
}

export function getUsageSummary(
  period: 'today' | 'week' | 'month' | 'all' = 'today',
  groupJid?: string,
  timezone = 'UTC',
): UsageSummary {
  ensureSchema();
  const filter = periodFilter(period, timezone);
  const groupFilter = groupJid
    ? (filter ? ' AND' : ' WHERE') + ' group_jid = ?'
    : '';
  const params = groupJid ? [groupJid] : [];
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) as invocations,
         COALESCE(SUM(input_tokens), 0) as input_tokens,
         COALESCE(SUM(output_tokens), 0) as output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
         COALESCE(SUM(cost_usd), 0) as total_cost_usd,
         COALESCE(SUM(duration_ms), 0) as total_duration_ms,
         COALESCE(SUM(num_turns), 0) as total_turns
       FROM usage_log ${filter}${groupFilter}`,
    )
    .get(...params) as UsageSummary;
  return row;
}

export function getUsageByGroup(
  period: 'today' | 'week' | 'month' | 'all' = 'today',
  timezone = 'UTC',
): GroupUsage[] {
  ensureSchema();
  const filter = periodFilter(period, timezone);
  return getDb()
    .prepare(
      `SELECT
         group_name,
         group_folder,
         COUNT(*) as invocations,
         COALESCE(SUM(input_tokens), 0) as input_tokens,
         COALESCE(SUM(output_tokens), 0) as output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
         COALESCE(SUM(cost_usd), 0) as total_cost_usd,
         COALESCE(SUM(duration_ms), 0) as total_duration_ms,
         COALESCE(SUM(num_turns), 0) as total_turns
       FROM usage_log ${filter}
       GROUP BY group_jid
       ORDER BY total_cost_usd DESC`,
    )
    .all() as GroupUsage[];
}

export function getUsageTimeline(
  days: number = 7,
  timezone = 'UTC',
): DailyUsage[] {
  ensureSchema();
  const offsetMod = sqliteUtcOffsetModifier(timezone);
  return getDb()
    .prepare(
      `SELECT
         date(datetime(timestamp, ?)) as date,
         COUNT(*) as invocations,
         COALESCE(SUM(input_tokens), 0) as input_tokens,
         COALESCE(SUM(output_tokens), 0) as output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
         COALESCE(SUM(cost_usd), 0) as total_cost_usd,
         COALESCE(SUM(duration_ms), 0) as total_duration_ms,
         COALESCE(SUM(num_turns), 0) as total_turns
       FROM usage_log
       WHERE timestamp >= datetime('now', ?)
       GROUP BY date(datetime(timestamp, ?))
       ORDER BY date DESC`,
    )
    .all(offsetMod, `-${days} days`, offsetMod) as DailyUsage[];
}
