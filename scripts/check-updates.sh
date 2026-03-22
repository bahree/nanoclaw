#!/bin/bash
# Weekly upstream update checker for NanoClaw.
# Fetches upstream, compares commits and skill branches, and sends
# a WhatsApp summary via IPC if there are updates available.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IPC_DIR="$PROJECT_DIR/data/ipc/whatsapp_main/messages"
MAIN_JID="14256479961@s.whatsapp.net"

cd "$PROJECT_DIR"

# Fetch upstream (quiet)
git fetch upstream --prune -q 2>/dev/null || {
  echo "Failed to fetch upstream" >&2
  exit 1
}

# Check main branch
UPSTREAM_BRANCH="main"
BASE=$(git merge-base HEAD "upstream/$UPSTREAM_BRANCH" 2>/dev/null || echo "")
if [ -z "$BASE" ]; then
  echo "No common ancestor with upstream" >&2
  exit 1
fi

NEW_COMMITS=$(git log --oneline "$BASE..upstream/$UPSTREAM_BRANCH" 2>/dev/null | wc -l)

# Check skill branches
SKILL_UPDATES=""
SKILL_COUNT=0
MAIN_BASE=$(git merge-base HEAD upstream/$UPSTREAM_BRANCH 2>/dev/null)

for branch in $(git branch -r --list 'upstream/skill/*' | sed 's/^ *//'); do
  name=$(echo "$branch" | sed 's|upstream/||')
  merge_base=$(git merge-base HEAD "$branch" 2>/dev/null || echo "")

  # Skip uninstalled skills
  if [ "$merge_base" = "$MAIN_BASE" ] || [ -z "$merge_base" ]; then
    continue
  fi

  new=$(git log --oneline "HEAD..$branch" 2>/dev/null | wc -l)
  if [ "$new" -gt 0 ]; then
    SKILL_UPDATES="${SKILL_UPDATES}\n- ${name}: ${new} new commits"
    SKILL_COUNT=$((SKILL_COUNT + 1))
  fi
done

# Nothing to report
if [ "$NEW_COMMITS" -eq 0 ] && [ "$SKILL_COUNT" -eq 0 ]; then
  echo "No updates available"
  exit 0
fi

# Build message
MSG="*NanoClaw Update Check*\n"

if [ "$NEW_COMMITS" -gt 0 ]; then
  # Get a few recent commit summaries
  RECENT=$(git log --oneline "$BASE..upstream/$UPSTREAM_BRANCH" | head -5)
  MSG="${MSG}\n*Upstream:* ${NEW_COMMITS} new commits"
  MSG="${MSG}\nRecent:\n${RECENT}"
  if [ "$NEW_COMMITS" -gt 5 ]; then
    MSG="${MSG}\n...and $((NEW_COMMITS - 5)) more"
  fi
fi

if [ "$SKILL_COUNT" -gt 0 ]; then
  MSG="${MSG}\n\n*Skill updates:*${SKILL_UPDATES}"
fi

MSG="${MSG}\n\n_Run /update-nanoclaw in Claude Code to apply._"

# Send via IPC
mkdir -p "$IPC_DIR"
FILENAME="$(date +%s)-update-check.json"
TMPFILE="$IPC_DIR/${FILENAME}.tmp"

# Escape for JSON
JSON_MSG=$(echo -e "$MSG" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip()))')

echo "{\"type\":\"message\",\"chatJid\":\"${MAIN_JID}\",\"text\":${JSON_MSG}}" > "$TMPFILE"
mv "$TMPFILE" "$IPC_DIR/$FILENAME"

echo "Update notification sent ($NEW_COMMITS upstream commits, $SKILL_COUNT skill updates)"
