# NanoClaw Migration Guide

Generated: 2026-04-22T18:28:09Z  
Base: a81e1651b5e48c9194162ffa2c50a22283d5ecd3  
HEAD at generation: 6572d0dbbe6e4446628bc8df5dae6129bf4c599b  
Upstream (target): dbb859bfeca74bf45e102a0d28c29172bf042131 (v2.0.1)

---

## Migration Plan

This is a v1 → v2.0.1 major-version upgrade. v2 is an architectural rewrite; many files have moved or changed structure. **Do not blindly copy-paste from this guide without first reading the target file in the worktree.** Every customization section flags whether adaptation is needed.

### Staging order

**Stage A — Channels** (apply first; other customizations may depend on channel types)
1. Apply channel skills from `upstream/channels` branch via `/add-*` skills
2. Verify channels compile

**Stage B — New source modules** (safe to add directly; these are net-new files)
3. Add custom source modules: `commands.ts`, `status.ts`, `event-log.ts`, `usage-log.ts`, `session-commands.ts`, `text-styles.ts`, `observability.ts`, `group-queue.ts`
4. Add timezone helpers to `src/timezone.ts`
5. Add minor additions to `src/db.ts`, `src/types.ts`

**Stage C — Modified source files** (requires careful diff of v2 target before applying)
6. Adapt `src/config.ts` — add custom config vars to v2's version
7. Adapt `src/router.ts` — channel-aware formatting
8. Adapt `src/ipc.ts`, `src/task-scheduler.ts` — add event logging calls
9. Adapt `src/index.ts` — add observability startup, usage logging, session commands, image parsing

**Stage D — Container** (v2 uses Bun; agent-runner is different)
10. Add custom Dockerfile layers (setpriv, .env shadow, QMD)
11. Add multimodal image support to agent-runner
12. Add usage telemetry to agent-runner
13. Add `/compact` command handling to agent-runner
14. Add Gmail + QMD MCP server entries to agent-runner
15. Add Ollama MCP server file (`ollama-mcp-stdio.ts`)

**Stage E — Credential approach**
16. Run `/init-onecli` to set up OneCLI Agent Vault (user chose OneCLI over custom proxy)
17. Do NOT port `src/credential-proxy.ts` — it is replaced by OneCLI
18. Adapt `src/container-runner.ts` — add volume mounts, image attachments, privilege handling; remove proxy-specific env var injection (OneCLI handles credentials)

**Stage F — Data and config**
19. Copy `groups/global/CLAUDE.md` from pre-migration backup
20. Copy `workflows/` directory
21. Copy `scripts/` additions (check-updates.sh, qmd-sync.sh, restart-all.sh)
22. Copy `QUICKREF.md`
23. Copy `container/skills/qmd/`, `container/skills/workflows/`
24. Copy custom skills from `.claude/skills/`

### Risk areas

- **`src/index.ts`** — v2 orchestrator is heavily restructured; add customizations surgically rather than overwriting
- **`src/container-runner.ts`** — v2 has different mount architecture for the new entity model; volume mounts need to be merged carefully
- **Container agent-runner** — v2 uses Bun, not Node; ensure TypeScript types are compatible
- **Channels** — v2 channels use a new registry pattern from the `channels` branch; apply via `/add-*` skills, not by copying channel files directly
- **`src/credential-proxy.ts`** — do NOT port; user is switching to OneCLI

---

## Applied Skills

These channel skills are in the `channels` branch in v2 (not in trunk). Apply them using the `/add-*` skill instructions, which copy files from `upstream/channels`:

| Skill | v2 install method |
|-------|-------------------|
| WhatsApp | `/add-whatsapp` skill (copies from `upstream/channels`) |
| Gmail | `/add-gmail` skill (copies from `upstream/channels`) |
| Emacs | `/add-emacs` skill (copies from `upstream/channels`) |
| image-vision | `/add-image-vision` skill |
| voice-transcription | `/add-voice-transcription` skill |
| channel-formatting | `/channel-formatting` skill |
| compact | Already in trunk (or run `/add-compact`) |
| ollama-tool | `/add-ollama-tool` skill |
| qmd | Check if still a skill branch; if so, merge `upstream/skill/qmd` |

**Custom skills** (not from upstream — copy directory as-is from the backup):
- `.claude/skills/add-slack/`
- `.claude/skills/add-discord/`
- `.claude/skills/add-telegram/`
- `.claude/skills/add-telegram-swarm/`
- `.claude/skills/add-reactions/`
- `.claude/skills/add-pdf-reader/`
- `.claude/skills/add-macos-statusbar/`
- `.claude/skills/add-karpathy-llm-wiki/`
- `.claude/skills/add-parallel/`

---

## Skill Interactions

- **channel-formatting + text-styles.ts**: The `channel-formatting` skill and the custom `src/text-styles.ts` module both handle Markdown→native conversion. They serve the same purpose. In v2, check if `channel-formatting` brings in its own `parseTextStyles`; if so, remove or merge with `text-styles.ts` to avoid duplication.
- **compact skill + session-commands.ts**: The `compact` skill and `session-commands.ts` both wire up `/compact`. Check v2 compact skill implementation; the custom `session-commands.ts` may overlap. Keep whichever implementation has better auth gating.
- **ollama-tool + ollama-mcp-stdio.ts**: The `ollama-tool` skill adds the MCP server to `.claude/skills/`. The custom `ollama-mcp-stdio.ts` in agent-runner adds a different MCP server with admin-gated model management. These are complementary, not conflicting.

---

## Modifications to Applied Skills

### Gmail: keep-unread and processed-ID persistence

**Intent:** After the `skill/gmail` merge, two fixes were applied:
1. Emails remain unread after NanoClaw processes them (the skill auto-marked them read)
2. Processed email IDs are persisted to disk so restarts don't re-process old emails

**Files:** `src/channels/gmail.ts`

**How to apply** (after the Gmail channel files are in place from `/add-gmail`):

1. Add near the top of `src/channels/gmail.ts` (before the class definition):

```typescript
const PROCESSED_IDS_PATH = path.join(
  process.cwd(),
  'store',
  'gmail-processed-ids.json',
);

function loadProcessedIds(): string[] {
  try {
    if (fs.existsSync(PROCESSED_IDS_PATH)) {
      return JSON.parse(fs.readFileSync(PROCESSED_IDS_PATH, 'utf-8')) as string[];
    }
  } catch {
    // ignore corrupt file — start fresh
  }
  return [];
}

function saveProcessedIds(ids: Set<string>): void {
  try {
    fs.mkdirSync(path.dirname(PROCESSED_IDS_PATH), { recursive: true });
    fs.writeFileSync(PROCESSED_IDS_PATH, JSON.stringify([...ids]));
  } catch {
    // non-fatal
  }
}
```

2. In the `GmailChannel` class, change the `processedIds` field initialization:
```typescript
// Before:
private processedIds = new Set<string>();
// After:
private processedIds = new Set<string>(loadProcessedIds());
```

3. In the email poll loop, when adding a new ID call `saveProcessedIds`:
```typescript
this.processedIds.add(stub.id);
saveProcessedIds(this.processedIds);   // ← add this line
await this.processMessage(stub.id);
```

4. Add the cap-at-5000 cleanup after the loop:
```typescript
if (this.processedIds.size > 5000) {
  const ids = [...this.processedIds];
  this.processedIds = new Set(ids.slice(ids.length - 2500));
  saveProcessedIds(this.processedIds);
}
```

5. Remove any `gmail.users.messages.modify()` call that removes the `UNREAD` label. Emails must stay unread.

---

## Customizations

### 1. Credential proxy — SKIP (replaced by OneCLI)

**Decision:** User chose to switch to OneCLI in v2. Do NOT port `src/credential-proxy.ts`.

**After migration:** Run `/init-onecli` to set up OneCLI Agent Vault and migrate API keys.

**Impact on other files:** Anywhere the v1 code referenced the credential proxy (index.ts proxy startup, container-runner.ts ANTHROPIC_BASE_URL injection, config.ts CREDENTIAL_PROXY_PORT), these should be left as-is in v2 (OneCLI handles the credential path). Do not add proxy startup code to v2's `src/index.ts`.

---

### 2. Assistant name: Claw

**Intent:** The assistant is named "Claw" not "Andy".

**Files:** `.env` or environment

**How to apply:** Set `ASSISTANT_NAME=Claw` in the `.env` file (or in the OneCLI vault as an env var).

---

### 3. Custom config vars in src/config.ts

**Intent:** Add `OLLAMA_ADMIN_TOOLS`, `CREDENTIAL_PROXY_PORT` (proxy — skip for OneCLI), and the mid-message trigger pattern.

**Files:** `src/config.ts`

**How to apply:** Read v2's `src/config.ts` first, then add only what's missing:

a) Add `OLLAMA_ADMIN_TOOLS` env var read and export:
```typescript
const envConfig = readEnvFile([
  // ... existing entries ...
  'OLLAMA_ADMIN_TOOLS',
]);
export const OLLAMA_ADMIN_TOOLS =
  (process.env.OLLAMA_ADMIN_TOOLS || envConfig.OLLAMA_ADMIN_TOOLS) === 'true';
```

b) Change the trigger pattern from `^${escapeRegex(...)}` (start-of-string anchor) to `${escapeRegex(...)}` (anywhere in message). In `buildTriggerPattern`:
```typescript
// Before:
return new RegExp(`^${escapeRegex(trigger.trim())}\\b`, 'i');
// After:
return new RegExp(`${escapeRegex(trigger.trim())}\\b`, 'i');
```

c) Skip `CREDENTIAL_PROXY_PORT` — not needed with OneCLI.

---

### 4. src/container-runtime.ts — proxy bind host detection

**Intent:** Detect the correct bind host for the credential proxy based on OS. In v2 with OneCLI this file may need no changes, but add if needed for other purposes.

**Files:** `src/container-runtime.ts`

**How to apply:** Read v2's version. If `PROXY_BIND_HOST` and `detectProxyBindHost()` are absent (they won't be needed with OneCLI), skip this. If the file needs Linux/WSL detection for any other reason, add:

```typescript
export const PROXY_BIND_HOST =
  process.env.CREDENTIAL_PROXY_HOST || detectProxyBindHost();

function detectProxyBindHost(): string {
  if (os.platform() === 'darwin') return '127.0.0.1';
  // WSL: /proc filesystem check is more reliable than env vars under systemd
  if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) return '127.0.0.1';
  // Bare-metal Linux: use docker0 bridge IP
  const ifaces = os.networkInterfaces();
  const docker0 = ifaces['docker0'];
  if (docker0) {
    const ipv4 = docker0.find((a) => a.family === 'IPv4');
    if (ipv4) return ipv4.address;
  }
  return '0.0.0.0';
}
```

---

### 5. src/container-runner.ts — volume mounts, image attachments, privilege handling

**Intent:** Several non-proxy additions: Gmail OAuth directory mount, workflow templates mount, per-group .claude/ session isolation, image attachments, privilege dropping via RUN_UID/GID, .env shadowing.

**Files:** `src/container-runner.ts`

**⚠️ Risk:** v2 container-runner has a different architecture. Read the v2 version carefully before applying. Add only what's absent.

**How to apply:**

a) **Image attachments** — add to `ContainerInput` interface:
```typescript
imageAttachments?: Array<{ relativePath: string; mediaType: string }>;
```

b) **UsageData interface** — add:
```typescript
export interface UsageData {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
}
```
And add `usage?: UsageData` to `ContainerOutput`.

c) **Volume mounts** — if v2 doesn't already mount these, add to `buildVolumeMounts()`:

Gmail credentials:
```typescript
const gmailDir = path.join(os.homedir(), '.gmail-mcp');
if (fs.existsSync(gmailDir)) {
  mounts.push({
    hostPath: gmailDir,
    containerPath: '/home/node/.gmail-mcp',
    readonly: false, // MCP may refresh OAuth tokens
  });
}
```

Workflow templates (read-only to all groups):
```typescript
const workflowsDir = path.join(projectRoot, 'workflows', 'available');
if (fs.existsSync(workflowsDir)) {
  mounts.push({
    hostPath: workflowsDir,
    containerPath: '/workspace/workflows',
    readonly: true,
  });
}
```

Per-group .claude/ session isolation (prevents cross-group session access):
```typescript
const groupSessionsDir = path.join(DATA_DIR, 'sessions', group.folder, '.claude');
fs.mkdirSync(groupSessionsDir, { recursive: true });
// Create settings.json if absent (enables agent teams, additional CLAUDE.md dirs, auto-memory)
const settingsFile = path.join(groupSessionsDir, 'settings.json');
if (!fs.existsSync(settingsFile)) {
  fs.writeFileSync(settingsFile, JSON.stringify({
    env: {
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
    },
  }, null, 2) + '\n');
}
// Sync container/skills/ into per-group .claude/skills/
const skillsSrc = path.join(process.cwd(), 'container', 'skills');
const skillsDst = path.join(groupSessionsDir, 'skills');
if (fs.existsSync(skillsSrc)) {
  for (const skillDir of fs.readdirSync(skillsSrc)) {
    const srcDir = path.join(skillsSrc, skillDir);
    if (!fs.statSync(srcDir).isDirectory()) continue;
    fs.cpSync(srcDir, path.join(skillsDst, skillDir), { recursive: true });
  }
}
mounts.push({ hostPath: groupSessionsDir, containerPath: '/home/node/.claude', readonly: false });
```

d) **Privilege dropping** — in `buildContainerArgs()`, where user/UID args are set:
```typescript
const hostUid = process.getuid?.();
const hostGid = process.getgid?.();
if (hostUid != null && hostUid !== 0) {
  if (isMain) {
    // Main starts as root so entrypoint can mount --bind to shadow .env.
    // setpriv in entrypoint.sh drops privileges to RUN_UID.
    args.push('-e', `RUN_UID=${hostUid}`);
    args.push('-e', `RUN_GID=${hostGid}`);
  } else {
    args.push('--user', `${hostUid}:${hostGid}`);
  }
  args.push('-e', 'HOME=/home/node');
}
```

e) **NANOCLAW_GROUP_FOLDER env var** — pass group folder so agent-runner can scope QMD searches:
```typescript
args.push('-e', `NANOCLAW_GROUP_FOLDER=${groupFolder}`);
```

f) **OLLAMA_ADMIN_TOOLS** — forward if enabled:
```typescript
if (OLLAMA_ADMIN_TOOLS) {
  args.push('-e', 'OLLAMA_ADMIN_TOOLS=true');
}
```

g) **Skip OneCLI proxy env vars** — do NOT add `ANTHROPIC_BASE_URL=http://host.docker.internal:...`. OneCLI handles credential injection.

---

### 6. src/db.ts — workflow_id column and getDb() export

**Intent:** Support workflow template linking on scheduled tasks and allow external modules to access the database without circular imports.

**Files:** `src/db.ts`

**How to apply:** Read v2's db.ts. If these are absent, add:

a) Export `getDb()`:
```typescript
export function getDb(): Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}
```

b) Add `workflow_id` column migration to `scheduled_tasks` if not present in v2 schema.

c) Update `createTask()` to accept optional `workflow_id?: string | null`.

---

### 7. src/types.ts — workflow_id on ScheduledTask

**Files:** `src/types.ts`

**How to apply:** Add to the `ScheduledTask` interface:
```typescript
workflow_id?: string | null;
```

---

### 8. src/timezone.ts — UTC offset helpers for usage grouping

**Intent:** Enable timezone-aware grouping in `/usage` command (e.g. "today" = user's local midnight).

**Files:** `src/timezone.ts`

**How to apply:** Append to the file (after existing functions):

```typescript
export function startOfLocalDayUtcString(timezone: string): string {
  const tz = resolveTimezone(timezone);
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)!.value);
  const elapsedMs =
    (get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000;
  const midnightUtc = new Date(now.getTime() - elapsedMs - now.getMilliseconds());
  return midnightUtc.toISOString().replace('T', ' ').slice(0, 19);
}

export function sqliteUtcOffsetModifier(timezone: string): string {
  const tz = resolveTimezone(timezone);
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const lh = parseInt(parts.find((p) => p.type === 'hour')!.value);
  const lm = parseInt(parts.find((p) => p.type === 'minute')!.value);
  let offsetMin = lh * 60 + lm - (now.getUTCHours() * 60 + now.getUTCMinutes());
  if (offsetMin > 720) offsetMin -= 1440;
  if (offsetMin < -720) offsetMin += 1440;
  const sign = offsetMin >= 0 ? '+' : '-';
  return `${sign}${Math.abs(offsetMin)} minutes`;
}
```

---

### 9. src/router.ts — channel-aware text formatting

**Intent:** Call `parseTextStyles()` before sending so Claude's Markdown output becomes WhatsApp/Telegram/Slack native syntax.

**Files:** `src/router.ts`

**How to apply:** Read v2's router.ts. If `formatOutbound` doesn't already accept a `channel` parameter:

a) Change signature:
```typescript
// Before:
function formatOutbound(rawText: string): string
// After:
function formatOutbound(rawText: string, channel?: ChannelType): string
```

b) Add at the top of the function body:
```typescript
import { parseTextStyles } from './text-styles.js';
// ...
if (channel) {
  text = parseTextStyles(text, channel);
}
```

c) Pass `channel` wherever `formatOutbound` is called from the message pipeline.

---

### 10. src/group-queue.ts — getStatus() method

**Intent:** Enable `/status` command to show active container, waiting, and pending counts per group.

**Files:** `src/group-queue.ts`

**How to apply:** If v2's group-queue doesn't have this, add a `getStatus()` method to the queue class:
```typescript
getStatus(): { active: number; waiting: number; pending: number } {
  return {
    active: this.activeCount,
    waiting: this.queue.length,
    pending: this.pendingCount ?? 0,
  };
}
```
(Adjust field names to match v2's internal state variables.)

---

### 11. src/event-log.ts — NEW FILE

**Intent:** Structured event/action/tool-call logging to SQLite for `/debug` command. Fire-and-forget (never blocks pipeline).

**Files:** `src/event-log.ts` (copy verbatim from pre-migration backup)

**How to apply:** Copy the file from `$BACKUP_BRANCH:src/event-log.ts`. It is self-contained — creates its own SQLite tables (no db.ts changes needed).

Key exports for reference: `logEvent`, `logAction`, `logToolCall`, `getLastActions`, `getActionsForEvent`, `getLastActionWithToolCalls`, `buildLogReport`, `startLogPruning`.

---

### 12. src/usage-log.ts — NEW FILE

**Intent:** Token/cost tracking per invocation with timezone-aware grouping. Powers `/usage` command.

**Files:** `src/usage-log.ts` (copy verbatim from pre-migration backup)

**How to apply:** Copy from `$BACKUP_BRANCH:src/usage-log.ts`. Depends on `src/timezone.ts` helpers (`startOfLocalDayUtcString`, `sqliteUtcOffsetModifier`) — apply those first (Section 8).

Cost formula used: `input_tokens * 0.003 + output_tokens * 0.015 / 1000` (Sonnet 4 pricing — update if model changes).

---

### 13. src/observability.ts — NEW FILE

**Intent:** Thin facade re-exporting event-log functions plus a `logInboundMessage()` helper that infers channel from JID.

**Files:** `src/observability.ts` (copy verbatim from pre-migration backup)

**How to apply:** Copy from `$BACKUP_BRANCH:src/observability.ts`. Depends on `event-log.ts`.

---

### 14. src/session-commands.ts — NEW FILE

**Intent:** `/compact` command support — parse, auth-gate, and execute context compaction mid-session.

**Files:** `src/session-commands.ts` (copy verbatim from pre-migration backup)

**How to apply:** Copy from `$BACKUP_BRANCH:src/session-commands.ts`. Check if v2's compact skill already provides this — if so, merge rather than duplicate. Key auth rule: only authorized senders (owner/admin) can trigger `/compact` in groups to prevent DoS.

---

### 15. src/text-styles.ts — NEW FILE

**Intent:** Convert Claude's Markdown to channel-native syntax (WhatsApp `*bold*` `_italic_`, Telegram same, Slack `mrkdwn`, Signal UTF-16 rich-text ranges, Discord passthrough).

**Files:** `src/text-styles.ts` (copy verbatim from pre-migration backup)

**How to apply:** Copy from `$BACKUP_BRANCH:src/text-styles.ts`. Check for overlap with `channel-formatting` skill (see Skill Interactions section). Main export: `parseTextStyles(text: string, channel: ChannelType): string`.

---

### 16. src/commands.ts — NEW FILE

**Intent:** Centralized slash command dispatch (`/status`, `/task`, `/debug`, `/usage`, `/remote-control`). Commands are intercepted before message storage and never reach the agent.

**Files:** `src/commands.ts` (copy verbatim from pre-migration backup)

**How to apply:** Copy from `$BACKUP_BRANCH:src/commands.ts`. Check if v2 already has a command-dispatch system — if so, merge the command handlers rather than adding a duplicate dispatcher.

Key behavior: trigger pattern (`@Claw /usage`) is stripped before command parsing. Group-scoped vs main-group commands: `/usage` and `/status` work per-group, `/debug` and `/remote-control` only in main group.

---

### 17. src/status.ts — NEW FILE

**Intent:** Command handler implementations for `/status`, `/task`, `/debug`, `/usage` (644 lines). Extracted from `index.ts` for maintainability.

**Files:** `src/status.ts` (copy verbatim from pre-migration backup)

**How to apply:** Copy from `$BACKUP_BRANCH:src/status.ts`. Depends on `event-log.ts`, `usage-log.ts`, `db.ts`, `timezone.ts`.

Key exports: `buildStatus`, `buildGroupStatus`, `buildTasksStatus`, `buildGroupTasksStatus`, `handleTaskCommand`, `handleDebugCommand`, `handleUsageCommand`.

---

### 18. src/ipc.ts — add event logging

**Intent:** Trace IPC activity (message sent, task scheduled) for `/debug`.

**Files:** `src/ipc.ts`

**How to apply:** Read v2's ipc.ts. Add event logging calls at key points:
```typescript
import { logEvent, logAction } from './event-log.js';

// When an IPC message is received:
logEvent('ipc', chatJid, { messageCount: messages.length }, groupName);

// When a message is sent via IPC:
logAction(eventId, 'ipc_sent', result, groupName);

// When a task is scheduled via IPC:
logAction(eventId, 'task_scheduled', { taskId, schedule }, groupName);
```

---

### 19. src/task-scheduler.ts — add event logging

**Intent:** Trace scheduled task execution starts and message sends for `/debug`.

**Files:** `src/task-scheduler.ts`

**How to apply:** Read v2's task-scheduler.ts. Add:
```typescript
import { logEvent, logAction } from './event-log.js';

// At task run start:
logEvent('scheduled_task', group.chatJid, { taskId: task.id, prompt: task.prompt }, group.name);

// After message sent:
logAction(eventId, 'task_message_sent', result, group.name);
```

---

### 20. src/index.ts — observability, usage logging, session commands, image parsing

**Intent:** Wire up all the new subsystems into the main orchestrator.

**Files:** `src/index.ts`

**⚠️ Risk:** v2 index.ts is heavily restructured. Read it carefully before applying. Add each item surgically.

**How to apply** (read v2 index.ts first, then add each piece where it fits):

a) **Observability startup** — in the startup/init section:
```typescript
import { startLogPruning } from './event-log.js';
// After DB init:
startLogPruning(); // Hourly retention cleanup for event_log
```

b) **Usage logging** — after container agent completes, log usage:
```typescript
import { logUsage } from './usage-log.js';
// After runContainerAgent() returns output:
if (output.usage) {
  logUsage(chatJid, group.name, group.folder, output.usage);
}
```

c) **Session commands** — intercept `/compact` BEFORE trigger check in message loop:
```typescript
import { handleSessionCommand, extractSessionCommand } from './session-commands.js';
// Before trigger check:
const sessionCmd = extractSessionCommand(content, triggerPattern);
if (sessionCmd) {
  await handleSessionCommand({ cmd: sessionCmd, group, chatJid, sender, isFromMe });
  continue; // don't process as normal message
}
```

d) **Image attachment parsing** — parse image references from messages and pass to container:
```typescript
import { parseImageReferences } from './image.js';
// When building ContainerInput:
const imageAttachments = parseImageReferences(pendingMessages);
// Pass to runContainerAgent input: { ..., imageAttachments }
```

e) **Inbound event logging**:
```typescript
import { logInboundMessage } from './observability.js';
// When a triggering message is received:
logInboundMessage(chatJid, sender, content, group.name);
```

f) **Channel-aware formatting** — pass channel type to formatOutbound:
```typescript
// Determine channel type from chatJid or group config
formatOutbound(rawText, group.channelType)
```

g) **Do NOT add proxy startup** (`startCredentialProxy`) — use OneCLI instead.

---

### 21. Container Dockerfile — setpriv, .env shadow, QMD

**Intent:** Security: main containers start as root, shadow host .env with /dev/null mount, then drop to host UID via `setpriv`. Also installs QMD for per-group conversation search.

**Files:** `container/Dockerfile`

**⚠️ Risk:** v2 container uses Bun, not Node. The base image and entrypoint are different. Adapt carefully.

**How to apply:** Read v2's Dockerfile first, then add what's missing:

a) **QMD global install** — in the RUN npm/pnpm install -g step, add `@tobilu/qmd`:
```dockerfile
RUN npm install -g agent-browser @anthropic-ai/claude-code @tobilu/qmd
```
(or pnpm equivalent if v2 uses pnpm)

b) **Entrypoint with setpriv and .env shadow** — the v1 entrypoint logic:
```bash
#!/bin/bash
set -e

# Shadow .env so the agent cannot read host secrets (requires root)
if [ "$(id -u)" = "0" ] && [ -f /workspace/project/.env ]; then
  mount --bind /dev/null /workspace/project/.env
fi

# Compile agent-runner (adjust for Bun if v2 uses bun build)
cd /app && npx tsc --outDir /tmp/dist 2>&1 >&2
ln -s /app/node_modules /tmp/dist/node_modules
chmod -R a-w /tmp/dist

# Capture stdin to temp file
cat > /tmp/input.json

# Drop privileges if running as root (main-group containers)
if [ "$(id -u)" = "0" ] && [ -n "$RUN_UID" ]; then
  chown "$RUN_UID:$RUN_GID" /tmp/input.json /tmp/dist
  exec setpriv --reuid="$RUN_UID" --regid="$RUN_GID" --clear-groups -- node /tmp/dist/index.js < /tmp/input.json
fi

exec node /tmp/dist/index.js < /tmp/input.json
```

If v2 uses Bun to run the agent-runner, adjust the `exec` line to use `bun run` instead of `node`. Keep the setpriv logic the same.

c) **Do NOT set `USER node`** in the Dockerfile — the entrypoint handles privilege dropping dynamically.

---

### 22. container/agent-runner — image attachments and usage telemetry

**Intent:** Agent-runner reads image attachments from the container input and sends them as multimodal content blocks. Also records token/cost usage in its output.

**Files:** `container/agent-runner/src/index.ts`

**⚠️ Risk:** v2 agent-runner is Bun-based and may be structured differently. Read before applying.

**How to apply:** Read v2's agent-runner index.ts. Add what's absent:

a) **Image attachments** — in the `ContainerInput` interface:
```typescript
imageAttachments?: Array<{ relativePath: string; mediaType: string }>;
```

In the message building logic, when `imageAttachments` is present, send multimodal content:
```typescript
if (input.imageAttachments?.length) {
  const contentBlocks: ContentBlock[] = [];
  for (const att of input.imageAttachments) {
    const imgPath = path.join('/workspace/group', att.relativePath);
    if (fs.existsSync(imgPath)) {
      const data = fs.readFileSync(imgPath).toString('base64');
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: att.mediaType as any, data },
      });
    }
  }
  contentBlocks.push({ type: 'text', text: input.prompt });
  // use contentBlocks as the message content instead of plain string
}
```

b) **Usage telemetry** — capture from the SDK response and include in output:
```typescript
export interface UsageData {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
}
```
Accumulate across turns and include in the final output JSON.

---

### 23. container/agent-runner — /compact command

**Intent:** Intercept `/compact` in the agent-runner poll loop and execute context compaction.

**Files:** `container/agent-runner/src/index.ts`

**How to apply:** Check if v2's agent-runner already handles `/compact`. If not, add to the message-handling loop:
- Match `/compact` exactly (not other slash commands to avoid accidental interception)
- Observe `compact_boundary` system message to confirm compaction completed
- Emit session markers with updated `sessionId` after compaction

---

### 24. container/agent-runner — Gmail and QMD MCP servers

**Intent:** Agents have access to Gmail (via MCP) and QMD semantic search over conversation history.

**Files:** `container/agent-runner/src/index.ts`

**How to apply:** In the MCP server configuration (wherever the agent's MCP servers are declared), add:

```typescript
gmail: {
  command: 'npx',
  args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
},
qmd: {
  type: 'http',
  url: 'http://host.docker.internal:8182/mcp',
},
```

And add to the allowed tools list: `mcp__gmail__*` and `mcp__qmd__*` (wildcard or enumerate specific tools).

---

### 25. container/agent-runner/src/ollama-mcp-stdio.ts — NEW FILE

**Intent:** Ollama local LLM MCP server. Read-only tools (list models, generate) always available; admin tools (pull, delete, show, list-running) gated behind `OLLAMA_ADMIN_TOOLS=true`.

**Files:** `container/agent-runner/src/ollama-mcp-stdio.ts` (copy verbatim from pre-migration backup)

**How to apply:** Copy from backup. Reference it in the agent-runner's MCP server setup. Networking: tries `http://host.docker.internal:11434` first, falls back to `localhost`. Writes status to `/workspace/ipc/ollama_status.json`.

---

### 26. container/agent-runner/src/ipc-mcp-stdio.ts — workflow_id support

**Intent:** Track which scheduled tasks are instances of which workflow templates.

**Files:** `container/agent-runner/src/ipc-mcp-stdio.ts`

**How to apply:** In the `schedule_task` MCP tool definition and handler, add `workflow_id` as an optional string argument. Pass it through to the task creation call.

---

### 27. container/skills/qmd/SKILL.md — NEW FILE

**Intent:** Guide agents on using QMD for per-group conversation semantic search.

**Files:** `container/skills/qmd/SKILL.md`

**How to apply:** Copy from backup. The skill documents:
- MCP tools: `mcp__qmd__query`, `mcp__qmd__get`, `mcp__qmd__multi_get`, `mcp__qmd__status`
- CLI fallback: `npx qmd search`, `npx qmd vsearch`
- Collection scoping via `NANOCLAW_GROUP_FOLDER` env var

---

### 28. container/skills/workflows/SKILL.md — NEW FILE

**Intent:** Guide agents on managing workflow templates (list, enable, disable, show status).

**Files:** `container/skills/workflows/SKILL.md`

**How to apply:** Copy from backup.

---

### 29. Global agent persona — groups/global/CLAUDE.md

**Intent:** Agent is named "Claw", has detailed no-double-send rules, and MUST persist user instructions to CLAUDE.md within the same session.

**Files:** `groups/global/CLAUDE.md`

**How to apply:** Copy verbatim from pre-migration backup. This file is user content, not code — copy it as-is. Key rules:
- Name: "Claw" (not "Andy")
- No-double-send: if `send_message` already sent content, wrap final output in `<internal>` tags
- Persisting user instructions: when user says "stop X" or "don't Y", immediately write the rule to `/workspace/group/CLAUDE.md` in the same session run

---

### 30. Workflow templates — workflows/available/

**Intent:** Six pre-built reusable automation templates. Users can enable them via chat.

**Files:** `workflows/available/` directory (6 files)

**How to apply:** Copy the entire `workflows/` directory from the pre-migration backup:
- `check-email.md` — Mon-Fri 9am and 2pm, process unread email
- `health-check.md` — every 6 hours, check group/container health
- `morning-briefing.md` — daily 7am, weather/news/priorities
- `news-digest.md` — daily 8am, AI/tech/business news
- `weekend-recap.md` — Monday 8am, weekend recap
- `weekly-planning.md` — Sunday 6pm, week review and planning

---

### 31. Scripts — check-updates.sh, qmd-sync.sh, restart-all.sh

**Files:** `scripts/` directory

**How to apply:** Copy all three from the pre-migration backup:

- **check-updates.sh** — fetches upstream, counts new commits on `main` and skill branches, sends WhatsApp notification if updates available. Hardcoded target JID: `14256479961@s.whatsapp.net` (Amit's number). Run weekly via cron.

- **qmd-sync.sh** — iterates `groups/*`, creates QMD collections, runs `qmd update` and `qmd embed --no-rerank` to re-index conversation history.

- **restart-all.sh** — multi-instance restart script for two deployments:
  ```bash
  INSTANCES=(
    "/home/amit/nanoclaw|nanoclaw"
    "/home/amit/nanoclaw-meenu|nanoclaw-meenu"
  )
  ```
  Pulls latest code, rebuilds, restarts via systemd for each instance.

---

### 32. QUICKREF.md — user guide

**Files:** `QUICKREF.md`

**How to apply:** Copy from pre-migration backup. This is a 230-line user-facing reference guide covering service management, feature matrix, usage patterns, and troubleshooting.

---

### 33. Custom skills

**Files:** `.claude/skills/` (9 custom directories)

**How to apply:** Copy each directory from the pre-migration backup (these are instruction-only SKILL.md files — no code to adapt):

| Directory | Purpose |
|-----------|---------|
| `add-slack/` | Slack channel (Socket Mode) |
| `add-discord/` | Discord bot channel |
| `add-telegram/` | Telegram channel (control + passive modes) |
| `add-telegram-swarm/` | Agent Swarm support for Telegram (multi-bot) |
| `add-reactions/` | WhatsApp emoji reactions (send, receive, store, search) |
| `add-pdf-reader/` | PDF extraction via pdftotext CLI |
| `add-macos-statusbar/` | macOS menu bar status indicator (Swift + bolt icon) |
| `add-karpathy-llm-wiki/` | Persistent wiki knowledge base (Karpathy LLM Wiki pattern) |
| `add-parallel/` | Parallel AI MCP integration for web research |

---

### 34. .env.example additions

**Files:** `.env.example`

**How to apply:** Add these lines to the v2 .env.example if not already present:
```
ASSISTANT_HAS_OWN_NUMBER=
OPENAI_API_KEY=
TELEGRAM_BOT_TOKEN=
OLLAMA_HOST=
```

---

### 35. package.json — custom dependencies

**Intent:** Skills and features that require npm packages beyond what v2 ships.

**Files:** `package.json`

**How to apply:** Read v2's package.json (it uses pnpm). Add any of these that are absent:

| Package | Version | Purpose |
|---------|---------|---------|
| `@whiskeysockets/baileys` | `^7.0.0-rc.9` | WhatsApp protocol (via add-whatsapp skill) |
| `googleapis` | `^144.0.0` | Gmail API client |
| `google-auth-library` | (latest) | Gmail OAuth |
| `sharp` | `^0.34.5` | Image processing for vision tasks |
| `zod` | `^4.3.6` | Schema validation (Ollama MCP) |
| `yaml` | `^2.8.2` | Workflow template YAML frontmatter parsing |
| `qrcode` | `^1.5.4` | QR code generation (WhatsApp auth) |
| `qrcode-terminal` | `^0.12.0` | Terminal QR display |
| `openai` | `^6.27.0` | OpenAI API (optional fallback LLM) |

Note: `pino` and `pino-pretty` are likely present in v2 (WhatsApp uses them). Check before adding.

After editing package.json, run `pnpm install` (v2 uses pnpm, not npm).

---

### 36. src/channels/whatsapp.ts — self-chat (fromMe) fix

**Intent:** Allow messages sent in WhatsApp self-chat (user messaging their own number) to be routed to the agent. The upstream adapter blanket-filters all `fromMe` messages to prevent echo loops, which also silently drops self-chat.

**Files:** `src/channels/whatsapp.ts` (copied from `upstream/channels` branch)

**Upstream status:** Gap in the channels branch — self-chat was not considered a use case. Track for a future upstream PR. Re-apply after every `whatsapp.ts` update.

**How to apply:** Three changes in `src/channels/whatsapp.ts`:

1. Add `ownJid` variable alongside `botLidUser` (around line 167):
```typescript
let botLidUser: string | undefined;
let ownJid: string | undefined; // own phone JID — used to detect self-chat (fromMe to own number)
```

2. Set `ownJid` in the connection handler where `sock.user` is checked (after the `botLidUser` block, around line 453):
```typescript
ownJid = `${phoneUser}@s.whatsapp.net`;
```

3. Replace the `fromMe` filter in `messages.upsert` handler:
```typescript
// BEFORE:
// Filter bot's own messages to prevent echo loops.
// fromMe is always true for messages sent from this linked device,
// regardless of ASSISTANT_HAS_OWN_NUMBER mode.
if (fromMe) continue;

// AFTER:
// Filter bot's own outgoing messages to prevent echo loops.
// Exception: self-chat (fromMe + chatJid === own number) — these
// are the user's own messages sent to themselves and must be routed.
const isSelfChat = fromMe && ownJid !== undefined && chatJid === ownJid;
if (fromMe && !isSelfChat) continue;
```

---

## Post-Migration Steps

1. Run `pnpm install && pnpm run build` in the worktree to validate
2. After swapping into main tree: run `/init-onecli` to set up OneCLI Agent Vault and migrate API keys from `.env`
3. Rebuild the container: `./container/build.sh`
4. Restart the service: `systemctl --user restart nanoclaw`
5. For the second instance (nanoclaw-meenu at `/home/amit/nanoclaw-meenu`): repeat migration separately or use `scripts/restart-all.sh` after both are upgraded

## Rollback

```bash
git reset --hard pre-update-6572d0d-20260422-181525
```

Backup branch also exists: `backup/pre-update-6572d0d-20260422-181525`
