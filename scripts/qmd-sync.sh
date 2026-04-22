#!/bin/bash
# Sync QMD collections for all NanoClaw groups that have conversation files.
# Run periodically via qmd-sync.timer to ensure new groups are indexed.

set -euo pipefail

QMD="${QMD_BIN:-$HOME/.local/bin/qmd}"
GROUPS_DIR="$(cd "$(dirname "$0")/.." && pwd)/groups"

if ! command -v "$QMD" &>/dev/null; then
  echo "qmd not found at $QMD — skipping sync" >&2
  exit 0
fi

echo "QMD sync starting (groups: $GROUPS_DIR)"

for group_dir in "$GROUPS_DIR"/*/; do
  group_dir="${group_dir%/}"
  group=$(basename "$group_dir")

  # Skip symlinks — they resolve to another group's folder, already covered
  [ -L "$group_dir" ] && continue

  conv_dir="$group_dir/conversations"
  [ -d "$conv_dir" ] || continue

  count=$(find "$conv_dir" -maxdepth 1 -name "*.md" | wc -l)
  [ "$count" -eq 0 ] && continue

  # Create collection if it doesn't exist yet
  if ! "$QMD" collection show "$group" &>/dev/null 2>&1; then
    echo "  Creating collection: $group ($count files)"
    "$QMD" collection add "$group_dir" --name "$group"
  fi
done

# Re-index all collections (picks up new/changed files)
echo "  Updating index..."
"$QMD" update

# Generate embeddings for any new chunks (CPU-friendly: no reranking)
echo "  Embedding new chunks..."
"$QMD" embed --no-rerank

echo "QMD sync complete"
