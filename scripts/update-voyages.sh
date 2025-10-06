#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_SRC="$REPO_ROOT/public"
# Default destination inside the local Signal K node_modules directory.
SIGNALK_BASE="/home/pi/.signalk/node_modules/voyage-webapp"
PUBLIC_SK="$SIGNALK_BASE/public"
cp "$PUBLIC_SK/voyages.json" "$PUBLIC_SRC"
cp "$PUBLIC_SK/Polar.json" "$PUBLIC_SRC"
git commit  -a -m 'update voyages & polar'
git push
