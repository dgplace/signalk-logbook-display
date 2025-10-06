#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_SRC="$REPO_ROOT/public"
# Default destination inside the local Signal K node_modules directory.
SIGNALK_BASE="/hpme/pi/.signalk/node_modules/voyage-webapp"
PUBLIC_SK="$SIGNALK_BASE/public"
echo cp "$PUBLIC_SK/*.json" "$PUBLIC_SRC"
echo git commit -m 'update voyages & polar'
echo git push
