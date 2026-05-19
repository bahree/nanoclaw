#!/bin/bash
# Verifies that all post-v2 local patches are still present after an upstream
# pull / merge / skill update. Run after every `/update-nanoclaw` or manual
# `git pull`. Exits 0 if all patches present, 1 otherwise.
#
# Companion to .nanoclaw-migrations/local-patches.md — keep checks in sync.

set -u
cd "$(dirname "$0")/.."

fail=0
check() {
  local name="$1"
  local result="$2"
  if [ "$result" = "OK" ]; then
    printf "  \033[32m✓\033[0m %s\n" "$name"
  else
    printf "  \033[31m✗\033[0m %s — MISSING, see .nanoclaw-migrations/local-patches.md\n" "$name"
    fail=1
  fi
}

echo "Verifying local patches…"

# 1. Teams OAuth
if grep -q 'CLAUDE_CODE_OAUTH_TOKEN=' src/container-runner.ts && \
   grep -q "ANTHROPIC_API_KEY=placeholder" src/container-runner.ts && \
   grep -q 'CLAUDE_CODE_OAUTH_TOKEN' src/config.ts; then
  check "Teams OAuth token injection" OK
else
  check "Teams OAuth token injection" MISSING
fi

# 2. Container DNS via local router
if grep -q 'resolveContainerDns' src/container-runner.ts && \
   grep -q "args.push('--dns'" src/container-runner.ts; then
  check "Container DNS via host gateway" OK
else
  check "Container DNS via host gateway" MISSING
fi

# 3. Routing fallback in dispatchResultText
if grep -q "import { getSessionRouting }" container/agent-runner/src/poll-loop.ts && \
   grep -q 'sent === 0 && scratchpad' container/agent-runner/src/poll-loop.ts; then
  check "Routing fallback (poll-loop dispatchResultText)" OK
else
  check "Routing fallback (poll-loop dispatchResultText)" MISSING
fi

# 4. Gmail MCP host mount
if grep -q "gmail-mcp" src/container-runner.ts; then
  check "Gmail MCP credentials mount" OK
else
  check "Gmail MCP credentials mount" MISSING
fi

# 5. WhatsApp shared-identity LID-rewrite guard
if grep -q "ASSISTANT_HAS_OWN_NUMBER && botLidUser" src/channels/whatsapp.ts; then
  check "WhatsApp shared-identity LID-rewrite guard" OK
else
  check "WhatsApp shared-identity LID-rewrite guard" MISSING
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "All local patches present."
else
  echo "Some patches missing. See .nanoclaw-migrations/local-patches.md for re-apply instructions."
fi
exit "$fail"
