#!/bin/bash
# Installs (or updates) Daybook.app in ~/Applications and opens it.
#   curl -fsSL https://raw.githubusercontent.com/zijianyuan-gh/pnl-app/main/mac/install.sh | bash
# Your trades are stored in the browser, not in the app, so updating never touches them.
set -euo pipefail
ZIP="${DAYBOOK_ZIP_URL:-https://github.com/zijianyuan-gh/pnl-app/releases/latest/download/Daybook-mac.zip}"
DEST="${DAYBOOK_DEST:-$HOME/Applications}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading Daybook…"
if [ -f "$ZIP" ]; then cp "$ZIP" "$tmp/daybook.zip"; else curl -fsSL "$ZIP" -o "$tmp/daybook.zip"; fi
ditto -x -k "$tmp/daybook.zip" "$tmp/out"
codesign --verify --deep --strict "$tmp/out/Daybook.app"

pkill -x daybook 2>/dev/null || true # stop an older running copy so the new one serves
mkdir -p "$DEST"
rm -rf "$DEST/Daybook.app"
mv "$tmp/out/Daybook.app" "$DEST/Daybook.app"
xattr -dr com.apple.quarantine "$DEST/Daybook.app" 2>/dev/null || true

if [ -z "${DAYBOOK_NO_OPEN:-}" ]; then open "$DEST/Daybook.app"; fi
echo "Daybook is installed: $DEST/Daybook.app — open it any time from Spotlight or Launchpad."
