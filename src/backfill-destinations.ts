/**
 * One-time backfill: seed `agent_destinations` rows for any existing
 * `messaging_group_agents` wiring that has no companion destination row.
 *
 * Runs after migrations, before channel adapters start. Idempotent — skips
 * pairs that already have a destination.
 *
 * Why this is necessary: migration 004 (`agent-destinations`) backfills at
 * the moment it runs, and `createMessagingGroupAgent` auto-creates a
 * destination row when called. But v1→v2 migration scripts (and any other
 * code path that inserts wirings via raw SQL) skip both, leaving wirings
 * without destinations. The visible symptom: the agent wraps replies in
 * `<message to="current conversation">...</message>` (an invented name)
 * which the router drops with `[dropped: unknown destination …]`.
 */
import { getDb, hasTable } from './db/connection.js';
import { log } from './log.js';

function normalizeName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unnamed'
  );
}

interface WiringRow {
  agent_group_id: string;
  messaging_group_id: string;
  channel_type: string;
  name: string | null;
}

export function backfillDestinations(): void {
  const db = getDb();
  if (!hasTable(db, 'agent_destinations')) return;

  const rows = db
    .prepare(
      `SELECT mga.agent_group_id, mga.messaging_group_id, mg.channel_type, mg.name
       FROM messaging_group_agents mga
       JOIN messaging_groups mg ON mg.id = mga.messaging_group_id`,
    )
    .all() as WiringRow[];

  const existing = db.prepare(
    'SELECT 1 FROM agent_destinations WHERE agent_group_id = ? AND target_type = ? AND target_id = ? LIMIT 1',
  );
  const taken = db.prepare('SELECT local_name FROM agent_destinations WHERE agent_group_id = ?');
  const insert = db.prepare(
    `INSERT INTO agent_destinations (agent_group_id, local_name, target_type, target_id, created_at)
     VALUES (?, ?, 'channel', ?, ?)`,
  );

  const now = new Date().toISOString();
  let inserted = 0;

  for (const row of rows) {
    if (existing.get(row.agent_group_id, 'channel', row.messaging_group_id)) continue;

    const takenNames = new Set(
      (taken.all(row.agent_group_id) as { local_name: string }[]).map((r) => r.local_name),
    );
    const base = normalizeName(row.name || `${row.channel_type}-${row.messaging_group_id.slice(0, 8)}`);
    let localName = base;
    let suffix = 2;
    while (takenNames.has(localName)) {
      localName = `${base}-${suffix}`;
      suffix++;
    }
    insert.run(row.agent_group_id, localName, row.messaging_group_id, now);
    inserted++;
  }

  if (inserted > 0) {
    log.info('Destinations backfilled', { inserted });
  }
}
