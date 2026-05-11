# Local Patches (post-v2)

Customizations applied to this fork that upstream does not include. After every `git pull` / `/update-nanoclaw` / `/update-skills`, **verify each patch is still intact** and re-apply any that conflicts dropped.

Run the verifier:

```bash
bash .nanoclaw-migrations/verify-local-patches.sh
```

It returns 0 if all patches are present, non-zero otherwise.

Detailed re-apply instructions for each patch live in `~/.claude/projects/-home-amit-nanoclaw/memory/`. Each memory file has the "Why" and "How to apply after upstream merge" sections.

---

## 1. Teams plan OAuth via env var

**Why:** User is on the Claude Teams subscription (no API key). Auth is a long-lived OAuth token from `claude setup-token`, injected as `CLAUDE_CODE_OAUTH_TOKEN`. The vault placeholder needs stripping; the token needs injecting. **Anti-pattern: do NOT mount the host `.credentials.json` — refresh-token rotation race causes 401 outages.**

**Files:**
- `src/container-runner.ts` — placeholder-strip + token inject block (after `onecli.applyContainerConfig`)
- `src/config.ts` — `CLAUDE_CODE_OAUTH_TOKEN` exported, listed in `readEnvFile([...])`

**Verify:**
```bash
grep -q 'CLAUDE_CODE_OAUTH_TOKEN=' src/container-runner.ts && \
  grep -q "ANTHROPIC_API_KEY=placeholder" src/container-runner.ts && \
  grep -q 'CLAUDE_CODE_OAUTH_TOKEN' src/config.ts && echo OK || echo MISSING
```

**Details:** `memory/project_teams_oauth_fix.md`

---

## 2. Container DNS via local router (Firewalla)

**Why:** Default Docker DNS leaks to 8.8.8.8 when host uses systemd-resolved (`127.0.0.53`), bypassing Firewalla + NextDNS filtering. Auto-detects the default-route gateway and passes `--dns <ip>` per container.

**Files:**
- `src/container-runner.ts` — `resolveContainerDns()` helper near top + `--dns` injection in `buildContainerArgs`
- Override: `NANOCLAW_CONTAINER_DNS=<ip>[,<ip>...]` in `.env`

**Verify:**
```bash
grep -q 'resolveContainerDns' src/container-runner.ts && \
  grep -q "args.push('--dns'" src/container-runner.ts && echo OK || echo MISSING
```

**Details:** `memory/project_container_dns_router.md`

---

## 3. Routing fallback in dispatchResultText

**Why:** Agent often replies as plain text without the required `<message to="…">` wrapper. Upstream's reworked `dispatchResultText` (2.0.54) has no bare-scratchpad fallback — `resolveDestinationThread` only runs when a `<message to=>` block was matched. Without this patch, replies to chat AND scheduled-task output silently drop to scratchpad. The fallback walks message-level routing → session_routing → writes the message out to the trigger channel.

**Files:**
- `container/agent-runner/src/poll-loop.ts` — `getSessionRouting` import + fallback block in `dispatchResultText`

**Verify:**
```bash
grep -q "import { getSessionRouting }" container/agent-runner/src/poll-loop.ts && \
  grep -q 'sent === 0 && scratchpad' container/agent-runner/src/poll-loop.ts && echo OK || echo MISSING
```

**Details:** `memory/project_routing_fallback_fix.md`

---

## 4. Gmail MCP integration (host mount only)

**Why:** Gmail MCP needs `~/.gmail-mcp/` credentials mounted into containers. Tool allowlist and per-group config used to be local patches too, but upstream 2.0.54 (a) auto-derives MCP tool allowlist patterns from registered servers, and (b) backfills `groups/*/container.json` into the `container_configs` DB table. The only remaining local patch is the host mount.

**Files:**
- `src/container-runner.ts` — `~/.gmail-mcp` mount in `buildMounts()`

**Verify:**
```bash
grep -q "gmail-mcp" src/container-runner.ts && echo OK || echo MISSING
```

**Details:** `memory/project_gmail_mcp.md`

---

## Notes

- `.nanoclaw-migrations/` is not touched by upstream, so this file survives any upstream pull.
- The verifier script is the authoritative check — keep its greps in sync with the patches.
- If a patch is dropped during an upstream merge, the memory file's "How to apply" section has copy-pasteable code blocks for re-application.
