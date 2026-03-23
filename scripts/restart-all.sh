#!/bin/bash
# Rebuild and restart all NanoClaw instances.
# Run after pushing changes from the main instance.

set -euo pipefail

INSTANCES=(
  "/home/amit/nanoclaw|nanoclaw"
  "/home/amit/nanoclaw-meenu|nanoclaw-meenu"
)

for entry in "${INSTANCES[@]}"; do
  dir="${entry%%|*}"
  service="${entry##*|}"

  if [ ! -d "$dir" ]; then
    echo "SKIP: $dir does not exist"
    continue
  fi

  echo "=== Updating $service ($dir) ==="

  cd "$dir"
  git pull --ff-only 2>&1 || { echo "WARN: git pull failed for $service, skipping"; continue; }
  npm run build 2>&1
  systemctl --user restart "$service"
  echo "$service restarted"
  echo ""
done

echo "All instances updated."
