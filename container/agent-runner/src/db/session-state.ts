/**
 * Persistent key/value state for the container. Lives in outbound.db
 * (container-owned, already scoped per channel/thread).
 *
 * Primary use: remember the SDK session ID so the agent's conversation
 * resumes across container restarts. Cleared by /clear.
 */
import { getOutboundDb } from './connection.js';
import type { TurnUsage } from '../providers/types.js';

const SDK_SESSION_KEY = 'sdk_session_id';

function getValue(key: string): string | undefined {
  const row = getOutboundDb()
    .prepare('SELECT value FROM session_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

function setValue(key: string, value: string): void {
  getOutboundDb()
    .prepare(
      'INSERT OR REPLACE INTO session_state (key, value, updated_at) VALUES (?, ?, ?)',
    )
    .run(key, value, new Date().toISOString());
}

function deleteValue(key: string): void {
  getOutboundDb().prepare('DELETE FROM session_state WHERE key = ?').run(key);
}

export function getStoredSessionId(): string | undefined {
  return getValue(SDK_SESSION_KEY);
}

export function setStoredSessionId(sessionId: string): void {
  setValue(SDK_SESSION_KEY, sessionId);
}

export function clearStoredSessionId(): void {
  deleteValue(SDK_SESSION_KEY);
}

// --- Session-lifetime usage accumulator ---

const USAGE_KEY = 'session_usage';

interface StoredUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  totalTurns: number;
  queries: number;
}

export function addSessionUsage(turn: TurnUsage): void {
  const raw = getValue(USAGE_KEY);
  const prev: StoredUsage = raw
    ? (JSON.parse(raw) as StoredUsage)
    : { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, totalTurns: 0, queries: 0 };
  const next: StoredUsage = {
    inputTokens: prev.inputTokens + turn.inputTokens,
    outputTokens: prev.outputTokens + turn.outputTokens,
    cacheReadTokens: prev.cacheReadTokens + turn.cacheReadTokens,
    cacheCreationTokens: prev.cacheCreationTokens + turn.cacheCreationTokens,
    costUsd: prev.costUsd + turn.costUsd,
    totalTurns: prev.totalTurns + turn.numTurns,
    queries: prev.queries + 1,
  };
  setValue(USAGE_KEY, JSON.stringify(next));
}

export function getSessionUsage(): StoredUsage {
  const raw = getValue(USAGE_KEY);
  return raw
    ? (JSON.parse(raw) as StoredUsage)
    : { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, totalTurns: 0, queries: 0 };
}

export function clearSessionUsage(): void {
  deleteValue(USAGE_KEY);
}
