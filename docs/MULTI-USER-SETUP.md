# Running Multiple NanoClaw Instances (Multi-User)

Each NanoClaw instance is linked to one WhatsApp account. To give another person their own private assistant, you run a second instance in a separate directory.

## How it works

Each instance is fully independent:

| Resource | Shared? | Notes |
|----------|---------|-------|
| Docker daemon | Yes | Same container runtime, separate containers |
| Container image | Yes | Same `nanoclaw-agent:latest` image |
| Machine/OS | Yes | Same Linux user, same home directory |
| Source code | No | Separate clone per instance |
| WhatsApp auth | No | Each instance links to a different phone |
| SQLite database | No | Separate `store/messages.db` per instance |
| Groups/memory | No | Separate `groups/` folder per instance |
| API credentials | Shared .env | Same Anthropic key, different proxy ports |
| Gmail credentials | Optional | Each user can have their own or share |
| Systemd service | No | One service file per instance |

## Setup steps

### 1. Clone a new instance

```bash
git clone https://github.com/bahree/nanoclaw.git ~/nanoclaw-USERNAME
cd ~/nanoclaw-USERNAME
```

Replace `USERNAME` with the person's name (e.g., `nanoclaw-meenu`, `nanoclaw-work`).

### 2. Install and build

```bash
npm install
npm run build
```

The container image is shared - no need to rebuild unless it doesn't exist yet:

```bash
# Only if you haven't built the container on this machine:
./container/build.sh
```

### 3. Create .env

The easiest way is to copy from the main instance and change the port:

```bash
cp ~/nanoclaw/.env ~/nanoclaw-USERNAME/.env
printf '\nCREDENTIAL_PROXY_PORT=300X\n' >> ~/nanoclaw-USERNAME/.env
```

Replace `300X` with the next available port (3002, 3003, etc.).

**Important:** Each instance needs a unique `CREDENTIAL_PROXY_PORT`. The default is 3001. Two instances on the same port will fail to start.

If creating from scratch instead:

```bash
nano ~/nanoclaw-USERNAME/.env
```

Required:
- `ASSISTANT_NAME=Claw`
- `CREDENTIAL_PROXY_PORT=300X`
- Anthropic API key or OAuth token (same as main instance)

Optional:
- `OPENAI_API_KEY` (for voice transcription)
- `MAX_CONCURRENT_CONTAINERS` (default 5 - lower this if running many instances)

### 4. Link WhatsApp

Run the WhatsApp authentication script:

```bash
cd ~/nanoclaw-USERNAME
npx tsx src/whatsapp-auth.ts --pairing-code
```

The script will ask for the phone number (with country code, no `+` or spaces, e.g. `919876543210`), then display a pairing code. The new user enters it on their phone:
- Open WhatsApp
- Settings > Linked Devices > Link a Device
- Tap "Link with phone number instead"
- Enter the pairing code

> **Tip:** The `--pairing-code` method is recommended, especially over SSH, where terminal QR codes are often hard to scan. If you prefer QR codes, omit the flag: `npx tsx src/whatsapp-auth.ts`

Once authenticated, verify the connection by starting the instance:

```bash
CREDENTIAL_PROXY_PORT=300X npm run dev
```

Send a test message, then register the self-chat or main group. Press Ctrl+C to stop the dev server.

### 5. Create systemd service

```bash
cat > ~/.config/systemd/user/nanoclaw-USERNAME.service << 'EOF'
[Unit]
Description=NanoClaw Personal Assistant (USERNAME)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /home/amit/nanoclaw-USERNAME/dist/index.js
WorkingDirectory=/home/amit/nanoclaw-USERNAME
Restart=always
RestartSec=5
Environment=HOME=/home/amit
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/home/amit/.local/bin
Environment=TZ=America/Los_Angeles
StandardOutput=append:/home/amit/nanoclaw-USERNAME/logs/nanoclaw.log
StandardError=append:/home/amit/nanoclaw-USERNAME/logs/nanoclaw.error.log

[Install]
WantedBy=default.target
EOF
```

Replace all `USERNAME` occurrences with the actual name.

Create the logs directory and start:

```bash
mkdir -p ~/nanoclaw-USERNAME/logs
systemctl --user daemon-reload
systemctl --user enable --now nanoclaw-USERNAME
```

Verify:

```bash
systemctl --user status nanoclaw-USERNAME
```

### 6. Gmail (optional)

If the new user wants Gmail access, they need their own OAuth credentials:

**Option A: Same GCP project, separate auth**
1. Copy `~/.gmail-mcp/gcp-oauth.keys.json` to `~/nanoclaw-USERNAME/.gmail-mcp/`
2. Run the OAuth flow (the new user authorizes with their own Gmail)

**Option B: No Gmail**
Skip this step. The agent will work without Gmail - it just won't be able to read/send emails.

## Managing multiple instances

```bash
# List all instances
systemctl --user list-units 'nanoclaw*' --no-pager

# Restart a specific instance
systemctl --user restart nanoclaw-meenu

# View logs for a specific instance
journalctl --user -u nanoclaw-meenu -f

# Stop an instance
systemctl --user stop nanoclaw-meenu
```

## Resource considerations

Each instance runs:
- 1 Node.js process (~100-180 MB RSS)
- Up to MAX_CONCURRENT_CONTAINERS Docker containers when active (each ~200-400 MB)
- 1 credential proxy on its own port

For a machine with 8 GB RAM, 2-3 instances with `MAX_CONCURRENT_CONTAINERS=3` each is comfortable. Adjust based on your machine.

## Port allocation

Keep track of which ports are in use:

| Instance | Credential proxy port |
|----------|----------------------|
| nanoclaw (main) | 3001 (default) |
| nanoclaw-meenu | 3002 |
| nanoclaw-work | 3003 |

## Updating instances

Each instance is a separate git clone pointing at the same GitHub repo.

### After pushing changes from the main instance

When you make changes in Claude Code (new skills, config, code fixes) and push them, all other instances need to pull, build, and restart. Use the included script:

```bash
~/nanoclaw/scripts/restart-all.sh
```

This script pulls, builds, and restarts every instance in one pass. It skips instances whose directories don't exist and continues past failures.

### Adding a new instance to the script

Edit `scripts/restart-all.sh` and add a line to the `INSTANCES` array:

```bash
INSTANCES=(
  "/home/amit/nanoclaw|nanoclaw"
  "/home/amit/nanoclaw-meenu|nanoclaw-meenu"
  "/home/amit/nanoclaw-work|nanoclaw-work"    # add new instances here
)
```

Format is `path|systemd-service-name`.

### Updating a single instance manually

```bash
cd ~/nanoclaw-USERNAME
git pull
npm install
npm run build
systemctl --user restart nanoclaw-USERNAME
```

### After upstream updates

When the weekly update checker notifies you about upstream changes:

1. Run `/update-nanoclaw` in Claude Code (main instance)
2. Push the merged changes: `git push`
3. Run `~/nanoclaw/scripts/restart-all.sh` to propagate to all instances

Or use `/update-nanoclaw` in Claude Code with the working directory set to each instance individually.
