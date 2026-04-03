# NanoClaw — Copilot Instructions

## Commands

```bash
npm run build          # Compile TypeScript → dist/
npm run dev            # Run with hot reload (tsx src/index.ts)
npm run test           # Run all tests once (vitest run)
npm run test:watch     # Watch mode
npm run lint           # ESLint on src/
npm run lint:fix       # ESLint with auto-fix
npm run format:fix     # Prettier auto-format
npm run typecheck      # tsc --noEmit
npm run rebuild        # Rebuild native modules (run after switching between Windows and WSL2)

# Run a single test file:
npx vitest run src/group-queue.test.ts

# Run skill tests (separate config):
npx vitest run --config vitest.skills.config.ts

# Rebuild agent container:
./container/build.sh
```

**Windows/WSL2 note:** `npm test` works on both. When switching between them, native modules (`better-sqlite3`, `rollup`) need rebuilding — run `npm run rebuild`.

## Architecture

Single Node.js process. Message flow:

```
Channel (WhatsApp/Telegram/etc.)
  → SQLite (messages table)
    → Polling loop (2 s) in src/index.ts
      → GroupQueue (per-group FIFO, global concurrency limit)
        → Container (Claude Agent SDK in isolated Linux VM)
          → IPC (filesystem: data/ipc/{group}/messages/)
            → Router → Channel (sends reply)
```

**Key files:**

| File | Role |
|------|------|
| `src/index.ts` | Orchestrator: state, polling loop, channel wiring |
| `src/channels/registry.ts` | Channel factory registration |
| `src/channels/index.ts` | Barrel file — importing it triggers channel self-registration |
| `src/router.ts` | Formats and routes outbound messages |
| `src/container-runner.ts` | Spawns containers, handles streaming I/O |
| `src/ipc.ts` | Filesystem IPC watcher and task dispatcher |
| `src/group-queue.ts` | Per-group queue with global concurrency cap |
| `src/task-scheduler.ts` | Cron/interval/once task runner |
| `src/remote-control.ts` | Remote Control session management |
| `src/db.ts` | All SQLite operations |
| `src/config.ts` | Env config, paths, trigger patterns |
| `src/types.ts` | Shared TypeScript interfaces |
| `container/agent-runner/src/index.ts` | Agent-side entry point (runs inside container) |

**Queue priority (within each group):** tasks drain before messages. Tasks are not rediscoverable from the DB once dequeued, so they get priority over messages which can be re-fetched.

**Graceful shutdown:** on `SIGTERM`/`SIGINT`, active containers are *detached* (not killed) so in-flight agent turns finish. The GroupQueue stops accepting new work, channels disconnect, then the process exits 0.

## Channel Registration

Channels self-register at startup. The barrel file `src/channels/index.ts` imports each channel module; each module calls `registerChannel()` at load time. If credentials are missing the factory must return `null` (channel is silently skipped).

```typescript
// src/channels/mychannel.ts
import { registerChannel } from './registry.js';

registerChannel('mychannel', (opts) => {
  if (!process.env.MY_TOKEN) return null;  // skip if unconfigured
  return new MyChannel(opts);
});
```

The `Channel` interface requires: `connect`, `sendMessage`, `isConnected`, `ownsJid`, `disconnect`. Optional: `setTyping`, `syncGroups`.

## Container & Security Model

- Agents run in Docker/Apple Container with only explicitly listed mounts
- **Main group** gets project root mounted read-only (`.env` shadowed with `/dev/null`) plus its group folder
- **Other groups** get only their group folder + `groups/global/CLAUDE.md` (read-only)
- API keys are never passed to containers — the OneCLI credential proxy injects them at request time
- IPC authorization is enforced by file path: a container writing to `data/ipc/{folder}/` can only act on its own group (except main group)
- Containers run as unprivileged `node` user (uid 1000, non-root)
- Failed container runs retry with exponential backoff (5 s base, up to 5 retries)

**IPC writes must be atomic:** write to a `.tmp` file, then rename. This prevents the watcher from reading a partially written file.

Output delimiters used for robust parsing:
```
---NANOCLAW_OUTPUT_START---
...agent response...
---NANOCLAW_OUTPUT_END---
```

**External config files** (never mounted into containers):
- `~/.config/nanoclaw/mount-allowlist.json` — controls which host paths containers may mount; blocks patterns like `.ssh`, `.env`, `credentials` by default
- `~/.config/nanoclaw/sender-allowlist.json` — per-chat sender restrictions; reloaded on every message cycle (no restart needed)

## Group Memory (three tiers)

1. `groups/main/CLAUDE.md` — main group memory, global preferences (read/write)
2. `groups/global/CLAUDE.md` — shared context visible to all groups (read-only for non-main)
3. `groups/{folder}/CLAUDE.md` — per-group instructions/personality (read/write by that group)

## TypeScript Conventions

- ES modules (`type: "module"`). **Always use `.js` extensions in imports**, even for `.ts` source files:
  ```typescript
  import { registerChannel } from './registry.js';
  ```
- Strict mode enabled. Target: `ES2022`, `moduleResolution: NodeNext`
- **Prefer `import.meta.url` over `process.cwd()` for path resolution** in new code — `process.cwd()` is fragile when the service is launched from a different directory (e.g. systemd). The existing codebase still uses `process.cwd()` in `config.ts`, `container-runner.ts`, and `env.ts` (tracked in upstream issue); prefer this pattern for any new path resolution:
  ```typescript
  import { fileURLToPath } from 'url';
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, '../..');
  ```
- Dependency injection via callback deps objects rather than global state:
  ```typescript
  export function startIpcWatcher(deps: { sendMessage, registeredGroups, ... }): void
  ```
- Global mutable state is kept at module level in `src/index.ts` and persisted to SQLite — not in-memory only

## Testing Conventions

- Test files: `src/**/*.test.ts`, `setup/**/*.test.ts`
- Mock `config.js` and `fs` modules at the top of test files with `vi.mock()`
- Use `vi.useFakeTimers()` for anything involving timing or async queues
- Skill tests live in `.claude/skills/{skill}/tests/*.test.ts` and use a separate vitest config

```typescript
vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanoclaw-test-data',
  MAX_CONCURRENT_CONTAINERS: 2,
}));
```

## SQLite Schema

Tables in `store/messages.db`:

| Table | Purpose |
|-------|---------|
| `messages` | All messages; queries capped at `MAX_MESSAGES_PER_PROMPT` (default 10) |
| `chats` | Chat metadata: name, last activity, channel, `is_group` |
| `sessions` | Claude session IDs per group folder |
| `registered_groups` | Active groups: folder, trigger, container config, `is_main` |
| `router_state` | Per-group message cursors and last processed timestamps |
| `scheduled_tasks` | Task definitions: schedule, `context_mode` (`group` or `isolated`), status |
| `task_run_logs` | Task execution history with duration and result |

## Skill System

Four skill types — don't conflate them:

| Type | Where | How applied |
|------|-------|-------------|
| **Feature** | `skill/{name}` branch + `.claude/skills/{name}/SKILL.md` | `git merge skill/{name}` |
| **Utility** | `.claude/skills/{name}/` with code files | Files copied to project |
| **Operational** | `.claude/skills/{name}/SKILL.md` on `main` | Instructions only, no code |
| **Container** | `container/skills/{name}/SKILL.md` | Loaded into agent VM at runtime |

**Rules for `main` branch:** Only bug fixes, security fixes, and simplifications. Features go as skill branches. A source change belongs on `main` only if 90%+ of users need it.

SKILL.md must start with YAML frontmatter (`name`, `description`) and stay under 500 lines. Put code in separate files, not inline.

## Container Build Cache Note

The buildkit cache for container builds is aggressive — `--no-cache` alone does **not** invalidate `COPY` steps. To force a truly clean rebuild, prune the builder first:

```bash
docker builder prune
./container/build.sh
```
