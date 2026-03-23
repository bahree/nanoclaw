# Setting Up NanoClaw on a New Machine

Guide for deploying this NanoClaw fork to a fresh Linux server. Covers everything from clone to running service.

## Prerequisites

- Linux (Ubuntu/Debian tested)
- Node.js 22+
- Docker
- Git

## 1. Clone the repo

```bash
git clone https://github.com/bahree/nanoclaw.git
cd nanoclaw
```

Add the upstream remote for future updates:

```bash
git remote add upstream https://github.com/qwibitai/nanoclaw.git
```

## 2. Install dependencies and build

```bash
npm install
npm run build
```

## 3. Build the agent container

```bash
./container/build.sh
```

This builds the Docker image that agents run inside. Rebuild after upstream updates that change `container/`.

## 4. Create .env

```bash
cp .env.example .env
nano .env
```

Required:
- `ASSISTANT_NAME=Claw` (or whatever you want to call it)
- Anthropic API key or OAuth token (see credential proxy docs)

Optional:
- `OPENAI_API_KEY` (for voice transcription via Whisper)
- `TELEGRAM_BOT_TOKEN` (if using Telegram channel)

## 5. Connect WhatsApp

WhatsApp auth is per-device and cannot be copied between machines. Run:

```bash
npm run dev
```

It will display a QR code or pairing code. Scan/enter it from your phone's WhatsApp (Linked Devices). Once connected, register your main group by messaging the assistant.

## 6. Gmail credentials

Two options:

**Option A: Copy from existing machine** (tokens are account-bound, not machine-bound)

```bash
# On the old machine:
scp ~/.gmail-mcp/* newmachine:~/.gmail-mcp/
```

**Option B: Re-authenticate**

The GCP OAuth app (`temporal-field-491014-r1`) is already published in Production mode, so tokens won't expire after 7 days. To re-auth:

1. Copy `gcp-oauth.keys.json` from the old machine (or download from GCP Console)
2. Place it in `~/.gmail-mcp/gcp-oauth.keys.json`
3. Delete any old `~/.gmail-mcp/credentials.json`
4. Run NanoClaw - the Gmail MCP will prompt for OAuth on first use

## 7. Set up systemd service

Enable lingering so user services run without an active login session:

```bash
loginctl enable-linger $USER
mkdir -p ~/.config/systemd/user
```

Create the service:

```bash
cat > ~/.config/systemd/user/nanoclaw.service << 'EOF'
[Unit]
Description=NanoClaw Personal Assistant
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/nanoclaw
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now nanoclaw
```

Verify:

```bash
systemctl --user status nanoclaw
```

## 8. Set up weekly update checker

The update checker runs weekly, fetches upstream, and sends a WhatsApp notification if updates are available.

```bash
cat > ~/.config/systemd/user/nanoclaw-update-check.service << 'EOF'
[Unit]
Description=NanoClaw upstream update checker
After=nanoclaw.service

[Service]
Type=oneshot
WorkingDirectory=%h/nanoclaw
ExecStart=%h/nanoclaw/scripts/check-updates.sh
EOF

cat > ~/.config/systemd/user/nanoclaw-update-check.timer << 'EOF'
[Unit]
Description=Weekly NanoClaw update check

[Timer]
OnCalendar=Sun 09:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now nanoclaw-update-check.timer
```

Verify:

```bash
systemctl --user list-timers
```

## 9. Verify everything works

1. Send `/status` in your main WhatsApp group - should get a system overview
2. Send a message to `@Claw` - should get a response
3. Check logs: `journalctl --user -u nanoclaw -f`

## What transfers between machines

| Thing | In git repo? | Action on new machine |
|-------|-------------|----------------------|
| Source code, skills, scripts | Yes | Just clone |
| WhatsApp auth | No | Re-scan QR code |
| Gmail credentials | No (gitignored) | Copy or re-auth (see step 6) |
| .env secrets | No (gitignored) | Create fresh |
| SQLite DB (messages, tasks, logs) | No (gitignored) | Starts fresh |
| systemd service/timer | No (~/.config) | Create manually (steps 7-8) |
| Container image | No | Run `./container/build.sh` |

## Common operations

```bash
# Restart
systemctl --user restart nanoclaw

# View logs
journalctl --user -u nanoclaw -f

# Update from upstream
# (use /update-nanoclaw in Claude Code, or manually:)
git fetch upstream
git merge upstream/main

# Rebuild after updates
npm run build
systemctl --user restart nanoclaw

# Rebuild container (after container/ changes)
./container/build.sh
systemctl --user restart nanoclaw
```
