#!/usr/bin/env bash
set -euo pipefail

# Build and package the Signal K plugin as an npm tarball

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed or not in PATH" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed or not in PATH" >&2
  exit 1
fi

if [[ ! -f package.json ]]; then
  echo "Error: package.json not found in $REPO_ROOT" >&2
  exit 1
fi

PKG_NAME="$(node -p "require('./package.json').name")"
PKG_VERSION="$(node -p "require('./package.json').version")"
TARBALL_NAME="${PKG_NAME}-${PKG_VERSION}.tgz"

echo "Packaging ${PKG_NAME}@${PKG_VERSION}..."

# Remove existing tarball with the same name to avoid confusion
rm -f "$TARBALL_NAME"

# Create tarball using npm pack (respects .npmignore/.gitignore)
PACK_OUT=$(npm pack --silent)

# npm pack outputs the file it created; normalize name if needed
if [[ "$PACK_OUT" != "$TARBALL_NAME" ]]; then
  mv -f "$PACK_OUT" "$TARBALL_NAME"
fi

echo "Created: $TARBALL_NAME"
echo "Done."

