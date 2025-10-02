#!/usr/bin/env bash
set -euo pipefail

# Fetch voyages.json from a remote Signal K server into the local public/ directory.
REMOTE_HOST="${1:-pi@tequila}"
REMOTE_PATH="${2:-~/.signalk/node_modules/voyage-webapp/public/voyages.json}"
REMOTE_PATH2="${2:-~/.signalk/node_modules/voyage-webapp/public/Polar.json}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST_FILE="$REPO_ROOT/public/voyages.json"
DEST_FILE2="$REPO_ROOT/public/Polar.json"

if ! command -v scp >/dev/null 2>&1; then
  echo "Error: scp command not found" >&2
  exit 1
fi

if [[ ! -d "$(dirname "$DEST_FILE")" ]]; then
  echo "Error: destination directory $(dirname "$DEST_FILE") does not exist" >&2
  exit 1
fi

echo "Copying $REMOTE_HOST:$REMOTE_PATH to $DEST_FILE"
scp "${REMOTE_HOST}:${REMOTE_PATH}" "$DEST_FILE"
echo "Copying $REMOTE_HOST:$REMOTE_PATH2 to $DEST_FILE2"
scp "${REMOTE_HOST}:${REMOTE_PATH2}" "$DEST_FILE2"

echo "Done."
