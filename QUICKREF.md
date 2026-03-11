# NanoClaw Quick Reference

Personal AI assistant running as a background service on your Linux server. Chat with **Claw** via WhatsApp, and it responds using Claude running inside Docker containers.

## How It Works

```
WhatsApp message → NanoClaw service → Docker container (Claude) → WhatsApp reply
```

- Messages go to your WhatsApp **self-chat** (Message Yourself)
- No trigger word needed — just type naturally
- Claw has access to your home directory (`/home/amit`)
- Each conversation runs in an isolated container with persistent memory
- Claw remembers past conversations — it builds up context over time

## Service Management

```bash
systemctl --user status nanoclaw      # check if running
systemctl --user start nanoclaw       # start
systemctl --user stop nanoclaw        # stop
systemctl --user restart nanoclaw     # restart
```

## Auto-Start on Reboot

Lingering is enabled — NanoClaw starts automatically at boot, even without logging in. Docker also auto-starts. No action needed after a reboot.

To **disable** auto-start:
```bash
systemctl --user disable nanoclaw     # stop auto-start at boot
```

To **re-enable** auto-start:
```bash
systemctl --user enable nanoclaw      # restore auto-start at boot
```

To fully remove auto-start (including lingering):
```bash
systemctl --user disable nanoclaw
sudo loginctl disable-linger amit
```

## Logs

```bash
tail -f ~/nanoclaw/logs/nanoclaw.log           # live service log
ls ~/nanoclaw/groups/whatsapp_main/logs/       # container logs
```

## What Claw Can Do

| Capability | Example message |
|------------|-----------------|
| General chat | "explain quantum computing simply" |
| Read/write files | "what's in my home directory?" |
| Run commands | "check disk usage on this server" |
| Browse the web | "what's the latest news on AI?" |
| Read emails | "check my recent emails" |
| Send emails | "send an email to bob@example.com saying hello" |
| Search emails | "find emails from Amazon about invoices" |
| Draft emails | "draft a reply to that last email" |
| Schedule tasks | "remind me every Monday at 9am to check reports" |
| Work with code | "read ~/project/main.py and explain what it does" |
| Browse websites | "go to hacker news and summarize the top 5 stories" |
| Math & analysis | "calculate the compound interest on 50k at 7% for 10 years" |

## Tips & Usage Ideas

### Productivity
- **Morning briefing:** "give me a summary — any new emails, and what's on my schedule today?"
- **Email triage:** "check my unread emails and tell me which ones are urgent"
- **Quick replies:** "reply to that email from Sarah saying I'll join the meeting at 3"
- **File management:** "find all PDFs in my Downloads folder larger than 10MB"
- **Server monitoring:** "how much disk space is left? any processes using high CPU?"

### Research & Learning
- **Web research:** "research the pros and cons of Rust vs Go for backend services"
- **Summarize content:** "go to this URL and summarize the article: [link]"
- **Explain concepts:** "explain Kubernetes networking like I'm a junior developer"
- **Compare options:** "compare the top 3 cloud storage providers for personal use"

### Coding & Development
- **Code review:** "read ~/project/app.py and suggest improvements"
- **Write scripts:** "write a bash script that backs up my postgres database daily"
- **Debug help:** "look at the error in ~/project/logs/error.log and tell me what's wrong"
- **Git operations:** "go to ~/myrepo and show me what changed in the last 5 commits"

### Scheduling & Reminders
- **Recurring tasks:** "every weekday at 8am, check my email and send me a summary"
- **One-time reminders:** "tomorrow at 2pm, remind me to call the dentist"
- **Monitoring:** "every hour, check if my website https://example.com is up"

### Personal
- **Travel planning:** "research flights from Seattle to Tokyo in April"
- **Recipes:** "find a quick dinner recipe using chicken and broccoli"
- **Writing help:** "help me draft a professional email declining a meeting invitation"
- **Translation:** "translate this to Spanish: I'll arrive at the airport at noon"

### How Others Use NanoClaw

- **Sysadmins** use it as a remote server assistant — check logs, restart services, monitor health, all from their phone
- **Developers** use it to manage code repos, run builds, and review pull requests without opening a laptop
- **Freelancers** use it to manage client emails — triage inbox, draft replies, track invoices
- **Students** use it as a study buddy — explain papers, quiz them on topics, summarize lecture notes
- **Teams** add it to a WhatsApp/Telegram/Slack group where multiple people can ask questions (with trigger word)
- **Home lab enthusiasts** use it to manage their server, run scripts, and automate tasks from anywhere

### Pro Tips

1. **Be specific** — "check my email" works, but "find unread emails from my boss in the last 24 hours" gets better results
2. **Chain requests** — "check my emails, then draft replies to anything urgent"
3. **It remembers context** — you can say "do the same thing you did yesterday" and it knows what you mean
4. **Files persist** — if you ask Claw to create a file, it'll still be there next conversation
5. **Group chats** — add Claw to a WhatsApp group and everyone can use it with `@Claw`
6. **Personality** — edit `~/nanoclaw/groups/whatsapp_main/CLAUDE.md` to customize how Claw behaves

## Configuration

| File | Purpose |
|------|---------|
| `~/nanoclaw/.env` | API keys (`ANTHROPIC_API_KEY`) |
| `~/nanoclaw/store/auth/creds.json` | WhatsApp credentials |
| `~/.gmail-mcp/` | Gmail OAuth credentials |
| `~/.config/nanoclaw/mount-allowlist.json` | Directories the agent can access |
| `~/nanoclaw/groups/whatsapp_main/CLAUDE.md` | Claw's memory and personality |

## Channels

Currently enabled: **WhatsApp** (self-chat, no trigger required)

Available to add later (run `claude` in the `~/nanoclaw` directory):
- `/add-telegram` — Telegram bot
- `/add-slack` — Slack integration
- `/add-discord` — Discord bot
- `/add-gmail` (channel mode) — auto-respond to incoming emails

## Integrations

Currently enabled: **Gmail** (tool-only — ask Claw to check/send email via WhatsApp)

Available to add later:
- `/add-voice-transcription` — transcribe WhatsApp voice notes
- `/add-image-vision` — process images sent via WhatsApp
- `/add-pdf-reader` — read PDF attachments
- `/add-ollama-tool` — local LLM for cheaper tasks

## Turning It Off

**Temporarily stop** (until you start it again or reboot):
```bash
systemctl --user stop nanoclaw
```

**Stop and prevent auto-start** (survives reboot):
```bash
systemctl --user stop nanoclaw
systemctl --user disable nanoclaw
```

**Completely remove:**
```bash
systemctl --user stop nanoclaw
systemctl --user disable nanoclaw
sudo loginctl disable-linger amit
rm ~/.config/systemd/user/nanoclaw.service
systemctl --user daemon-reload
```

## Troubleshooting

**Claw not responding?**
```bash
systemctl --user status nanoclaw                # is it running?
tail -20 ~/nanoclaw/logs/nanoclaw.log           # any errors?
docker ps                                        # is Docker running?
```

**WhatsApp disconnected?**
```bash
ls ~/nanoclaw/store/auth/creds.json             # credentials exist?
systemctl --user restart nanoclaw               # restart often fixes it
```

**Gmail not working?**
```bash
ls ~/.gmail-mcp/credentials.json                # OAuth token exists?
# If expired, re-authorize (need SSH tunnel for port 3000):
rm ~/.gmail-mcp/credentials.json
npx -y @gongrzhe/server-gmail-autoauth-mcp auth
# Then restart: systemctl --user restart nanoclaw
```

**Container issues?**
```bash
docker images | grep nanoclaw                   # image exists?
cd ~/nanoclaw/container && ./build.sh           # rebuild
systemctl --user restart nanoclaw
```

**After a reboot, nothing works?**
```bash
# Check Docker started
sudo systemctl status docker
# Check NanoClaw started
systemctl --user status nanoclaw
# If not, start manually
sudo systemctl start docker
systemctl --user start nanoclaw
```

## Updating

```bash
cd ~/nanoclaw
claude                                           # open Claude Code
# Then run: /update-nanoclaw
```

## Key Details

- **Trigger word:** @Claw (only needed in group chats, not self-chat)
- **Assistant name:** Claw
- **Phone number:** 14256479961
- **Container runtime:** Docker
- **Service type:** systemd user service (with lingering enabled)
- **Project path:** `/home/amit/nanoclaw`
- **Auto-start:** Yes, on boot (no login required)
