#!/usr/bin/env bash
set -euo pipefail

# Synchronise the front-end assets and root-level helper scripts into a local
# Signal K plugin directory for quick testing. Public assets exclude the
# generated voyages.json file to avoid overwriting runtime data.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_SRC="$REPO_ROOT/public"
JS_SRC_GLOB="$REPO_ROOT"/*.js
# Default destination inside the local Signal K node_modules directory.
DEST_BASE="${1:-$HOME/.signalk/node_modules/voyage-webapp}"
PUBLIC_DEST="$DEST_BASE/public"

if [[ ! -d "$PUBLIC_SRC" ]]; then
  echo "Error: public directory not found at $PUBLIC_SRC" >&2
  exit 1
fi

mkdir -p "$PUBLIC_DEST"

echo "Deploying public/ to $PUBLIC_DEST (excluding voyages.json)..."

if command -v rsync >/dev/null 2>&1; then
  rsync -av \
    --exclude 'voyages.json' \
    "$PUBLIC_SRC/" "$PUBLIC_DEST/"
else
  echo "rsync not found; using fallback copy (no deletes)." >&2
  # Copy all files except voyages.json while preserving structure
  (cd "$PUBLIC_SRC" && \
    find . -type f \( ! -name 'voyages.json' \) -print0 |
    while IFS= read -r -d '' f; do
      dest_path="$PUBLIC_DEST/${f#./}"
      mkdir -p "$(dirname "$dest_path")"
      cp -p "$PUBLIC_SRC/${f#./}" "$dest_path"
    done)
fi

echo "Copying root-level *.js files to $DEST_BASE..."
mkdir -p "$DEST_BASE"

shopt -s nullglob
root_js_files=($JS_SRC_GLOB)
shopt -u nullglob

for js_file in "${root_js_files[@]}"; do
  dest_file="$DEST_BASE/$(basename "$js_file")"
  cp -p "$js_file" "$dest_file"
done

echo "Done."
