#!/usr/bin/env bash
set -euo pipefail

# Copy voyage JSON assets from this repo into a local Signal K install.
SIGNALK_PUBLIC_DIR="${1:-$HOME/.signalk/node_modules/voyage-webapp/public}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="$REPO_ROOT/public"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Error: source directory $SOURCE_DIR does not exist" >&2
  exit 1
fi

if [[ ! -d "$SIGNALK_PUBLIC_DIR" ]]; then
  echo "Error: destination directory $SIGNALK_PUBLIC_DIR does not exist" >&2
  exit 1
fi

for asset_name in voyages.json Polar.json manual-voyages.json; do
  source_path="$SOURCE_DIR/$asset_name"
  dest_path="$SIGNALK_PUBLIC_DIR/$asset_name"
  if [[ ! -f "$source_path" ]]; then
    echo "Error: source file $source_path does not exist" >&2
    exit 1
  fi
  echo "Copying $source_path to $dest_path"
  cp -p "$source_path" "$dest_path"
done

echo "Done."
