---
applyTo: "**"
---

# NanoClaw Debugging

When the user reports something isn't working, start with `check_prerequisites` and `tail_logs` tools to get a baseline, then work through the relevant section below.

## Log Locations

| Log | Path | What's in it |
|-----|------|-------------|
| Main app | `logs/nanoclaw.log` | Routing, container spawning, IPC |
| Errors | `logs/nanoclaw.error.log` | Host-side errors |
| Container runs | `groups/{folder}/logs/container-*.log` | Per-run: input, mounts, stderr, stdout |

Use `tail_logs` tool with `log: "main"`, `"error"`, or `"container"`. Enable verbose logging with `LOG_LEVEL=debug npm run dev`.

## Quick Diagnostic

```bash
# Auth configured?
grep -E "ANTHROPIC_API_KEY=sk-|CLAUDE_CODE_OAUTH_TOKEN=sk-|ONECLI_URL=" .env

# Docker running?
docker info 2>&1 | head -3

# Container image exists?
docker image inspect nanoclaw-agent:latest --format "exists" 2>/dev/null || echo "MISSING"

# Service running? (Linux)
systemctl --user is-active nanoclaw

# Recent container logs
ls -t groups/*/logs/container-*.log 2>/dev/null | head -3
```

## Issue: "Claude Code process exited with code 1"

Check the most recent container log (`tail_logs` with `log: "container"`).

**Missing auth:**
```
Invalid API key · Please run /login
```
Fix: Check `.env` has `ANTHROPIC_API_KEY=sk-ant-...` or `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...`. Restart service.

**Root user restriction:**
```
--dangerously-skip-permissions cannot be used with root/sudo privileges
```
Fix: Container must run as non-root. Check `container/Dockerfile` has `USER node`.

**Session mount path wrong:**
Sessions stored at `data/sessions/{group}/.claude/` must be mounted to `/home/node/.claude/` inside the container (not `/root/.claude/`). Check `src/container-runner.ts`.

## Issue: No Response to Messages

1. Check trigger pattern — non-main groups need `@Andy` (or `ASSISTANT_NAME` value). Main channel has no trigger.
2. Check `logs/nanoclaw.log` for "No registered group" or "Trigger not matched".
3. Check the group is registered: `sqlite3 store/messages.db "SELECT * FROM registered_groups"`.
4. Verify message cursor isn't stuck: `sqlite3 store/messages.db "SELECT * FROM router_state"`.

## Issue: Channel Not Connecting

- **WhatsApp**: Check `store/auth/creds.json` exists. If missing, re-run auth.
- **Telegram/Slack/Discord**: Check token in `.env`. Test token validity manually:
  ```bash
  # Telegram
  curl https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe
  ```
- All channels: restart service after any `.env` change.

## Issue: Container Fails to Start

```bash
# Check Docker is running
docker info

# Check image exists and is healthy
docker run --rm nanoclaw-agent:latest node --version

# Interactive shell inside container
docker run --rm -it --entrypoint /bin/bash nanoclaw-agent:latest

# Verify mounts and permissions
docker run --rm --entrypoint /bin/bash nanoclaw-agent:latest -c 'whoami && ls -la /workspace/'
```

All of `/workspace/` should be owned by `node`. Containers run as non-root uid 1000.

## Issue: Container Builds but Won't Run

```bash
# Test full agent flow manually
mkdir -p data/env groups/test
cp .env data/env/env
echo '{"prompt":"What is 2+2?","groupFolder":"test","chatJid":"test@g.us","isMain":false}' | \
  docker run -i \
  -v $(pwd)/data/env:/workspace/env-dir:ro \
  -v $(pwd)/groups/test:/workspace/group \
  -v $(pwd)/data/ipc/test:/workspace/ipc \
  nanoclaw-agent:latest
```

## Issue: IPC Not Working

Agent-to-host communication goes through `data/ipc/{group}/`. Files are written atomically (`.tmp` then rename).

```bash
# Check IPC directories
ls -la data/ipc/

# Check pending messages
ls -la data/ipc/*/messages/ 2>/dev/null

# Check authorization (non-main groups can only write to their own folder)
# If you see "Unauthorized IPC" in logs, the group folder doesn't match
grep "Unauthorized" logs/nanoclaw.log | tail -10
```

## Issue: Sessions Not Resuming

Each group has a session ID stored in `sessions` table. If it keeps changing, sessions aren't being reused.

```bash
# Check session IDs in logs
grep "Session initialized" logs/nanoclaw.log | tail -10
# All lines for same group should show same session ID

# Clear sessions if corrupted
rm -rf data/sessions/{groupFolder}/.claude/
sqlite3 store/messages.db "DELETE FROM sessions WHERE group_folder = '{groupFolder}'"
```

## Issue: Scheduled Tasks Not Running

- Scheduler polls every 60 seconds — check logs for "Scheduler loop" entries.
- Check task status: `sqlite3 store/messages.db "SELECT * FROM scheduled_tasks"`
- Check run history: `sqlite3 store/messages.db "SELECT * FROM task_run_logs ORDER BY started_at DESC LIMIT 10"`
- Invalid cron expressions silently fail — check `logs/nanoclaw.log` for "Invalid cron expression".

## Rebuild After Changes

```bash
npm run build                    # Rebuild TypeScript
./container/build.sh             # Rebuild container (Linux/macOS/WSL2)
docker builder prune -f && ./container/build.sh  # Force clean container rebuild
npm run rebuild                  # Rebuild native modules (after platform switch)
```

## Service Management

```bash
# macOS
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # restart

# Linux
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
journalctl --user -u nanoclaw -f   # live logs via systemd
```
