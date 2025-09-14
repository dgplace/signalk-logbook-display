#!/usr/bin/env bash
set -euo pipefail

# Sync the contents of ./public to a Signal K data dir for quick testing,
# excluding the voyages.json file.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$REPO_ROOT/public"
# Default destination inside local Signal K data dir for this plugin's public assets
DEST_DIR="${1:-$HOME/.signalk/node_modules/voyage-webapp/public}"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "Error: public directory not found at $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

echo "Deploying public/ to $DEST_DIR (excluding voyages.json)..."

if command -v rsync >/dev/null 2>&1; then
  rsync -av \
    --exclude 'voyages.json' \
    "$SRC_DIR/" "$DEST_DIR/"
else
  echo "rsync not found; using fallback copy (no deletes)." >&2
  # Copy all files except voyages.json while preserving structure
  (cd "$SRC_DIR" && \
    find . -type f \( ! -name 'voyages.json' \) -print0 |
    while IFS= read -r -d '' f; do
      dest_path="$DEST_DIR/${f#./}"
      mkdir -p "$(dirname "$dest_path")"
      cp -p "$SRC_DIR/${f#./}" "$dest_path"
    done)
fi

echo "Done."
