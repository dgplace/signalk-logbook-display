#!/usr/bin/env bash
set -euo pipefail

# Copy voyage JSON assets from a local Signal K install into the repo public/ directory.
SIGNALK_PUBLIC_DIR="${1:-$HOME/.signalk/node_modules/voyage-webapp/public}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST_DIR="$REPO_ROOT/public"

if [[ ! -d "$SIGNALK_PUBLIC_DIR" ]]; then
  echo "Error: source directory $SIGNALK_PUBLIC_DIR does not exist" >&2
  exit 1
fi

if [[ ! -d "$DEST_DIR" ]]; then
  echo "Error: destination directory $DEST_DIR does not exist" >&2
  exit 1
fi

for asset_name in voyages.json Polar.json manual-voyages.json; do
  source_path="$SIGNALK_PUBLIC_DIR/$asset_name"
  dest_path="$DEST_DIR/$asset_name"
  echo "Copying $source_path to $dest_path"
  cp -p "$source_path" "$dest_path"
done

echo "Done."
