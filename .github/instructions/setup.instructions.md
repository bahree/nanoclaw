---
applyTo: "**"
---

# NanoClaw Setup

When the user asks to set up, install, or configure NanoClaw, work through these steps in order. Use the `check_prerequisites` tool to get current status before starting.

**Principle:** Fix things yourself where possible. Only pause when genuine user action is required (pasting a token, authenticating a channel, choosing between options).

## Step 0: Git Configuration

Run `git remote -v`. Three cases:

- **origin → qwibitai/nanoclaw** (cloned directly): User should fork. Ask if they want to set one up now. If yes: they fork on GitHub, then: `git remote rename origin upstream && git remote add origin https://github.com/<username>/nanoclaw.git && git push --force origin main`
- **origin → user's fork, no upstream**: `git remote add upstream https://github.com/qwibitai/nanoclaw.git`
- **Both exist**: Already correct, continue.

## Step 1: Node.js + Dependencies

Run `check_prerequisites` tool to see what's missing.

- Node.js 20+ required. Install via nvm if missing:
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
  source ~/.bashrc && nvm install 22
  ```
  macOS: `brew install node@22`
- Run `npm install` to install dependencies.
- If `better-sqlite3` fails (native build error): `sudo apt-get install build-essential` (Linux) or `xcode-select --install` (macOS), then retry.
- **Windows/WSL2 switching**: Run `npm run rebuild` after switching platforms.

## Step 2: Container Runtime

- **Linux / WSL2**: Docker only.
  - Not running: `sudo systemctl start docker` (Linux) or start Docker Desktop (WSL2)
  - Not installed: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER`
  - Just added to docker group: `sudo setfacl -m u:$(whoami):rw /var/run/docker.sock`
- **macOS**: Docker (recommended) or Apple Container. For Apple Container run the `/convert-to-apple-container` Claude Code skill.

Run `docker info` to confirm the runtime is up before proceeding.

## Step 3: Build Container

```bash
npx tsx setup/index.ts --step container -- --runtime docker
```

Use `rebuild_container` tool to build, or `rebuild_container` with `clean: true` to prune cache first.

- Build fail due to stale cache: `rebuild_container` with `clean: true`
- Other build failure: check `logs/setup.log` for the error

## Step 4: Credentials

Ask: **Anthropic API key** or **Claude subscription (Pro/Max)**?

**API key** — add to `.env`:
```bash
echo 'ANTHROPIC_API_KEY=sk-ant-api03-...' >> .env
```

**Claude subscription** — the `sk-ant-oat01-...` OAuth token is accepted just like an API key. Get it:
```bash
cat ~/.claude/.credentials.json | python3 -c "import sys,json; print(json.load(sys.stdin)['claudeAiOauth']['accessToken'])"
```

Then install OneCLI and register the secret:
```bash
curl -fsSL onecli.sh/install | sh && curl -fsSL onecli.sh/cli/install | sh
export PATH="$HOME/.local/bin:$PATH"
onecli config set api-host http://127.0.0.1:10254
onecli secrets create --name Anthropic --type anthropic --value <token> --host-pattern api.anthropic.com
echo 'ONECLI_URL=http://127.0.0.1:10254' >> .env
```

If the user pastes a token starting with `sk-ant-` directly in chat: run the `onecli secrets create` command on their behalf.

## Step 5: Channels

Ask which channels to enable (WhatsApp / Telegram / Slack / Discord). For each:

- **WhatsApp**: `npx tsx setup/index.ts --step whatsapp-auth`
- **Telegram**: Add `TELEGRAM_BOT_TOKEN=...` to `.env`
- **Slack**: Add `SLACK_BOT_TOKEN=...` and `SLACK_APP_TOKEN=xapp-...` to `.env`
- **Discord**: Add `DISCORD_BOT_TOKEN=...` to `.env`

After all channels: `npm install && npm run build`

## Step 6: Mount Allowlist

```bash
npx tsx setup/index.ts --step mounts -- --empty
```

To add external directories (e.g. Obsidian vault, projects):
```bash
npx tsx setup/index.ts --step mounts -- --json '{"allowedRoots":[{"path":"~/projects","allowReadWrite":true}],"blockedPatterns":[],"nonMainReadOnly":true}'
```

## Step 7: Start Service

```bash
npx tsx setup/index.ts --step service
```

- **macOS launchd**: `launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist`
- **Linux systemd**: `systemctl --user enable --now nanoclaw`
- **WSL2 without systemd**: use the generated `start-nanoclaw.sh`

After starting, run `get_service_status` tool and `tail_logs` to verify it came up cleanly.

## Step 8: Verify

```bash
npx tsx setup/index.ts --step verify
```

Common failures:
- `SERVICE=stopped` → `npm run build` then restart service
- `CREDENTIALS=missing` → re-check Step 4
- `REGISTERED_GROUPS=0` → re-run the channel auth step
- `MOUNT_ALLOWLIST=missing` → re-run Step 6

Have the user send a test message. Watch with `tail_logs`. Main channel doesn't need a trigger prefix — other groups need `@Andy` (or whatever `ASSISTANT_NAME` is set to).

## Common Issues

| Symptom | Fix |
|---------|-----|
| "Claude Code process exited with code 1" | Check `groups/main/logs/container-*.log`. Usually missing credentials or Docker not running. |
| Service starts but no responses | Check trigger pattern. Check `logs/nanoclaw.log` for errors. |
| Channel not connecting | Verify `.env` has the right token. Restart service after any `.env` change. |
| Native module errors after platform switch | `npm run rebuild` |
| Container build uses stale cache | `docker builder prune -f && ./container/build.sh` |
