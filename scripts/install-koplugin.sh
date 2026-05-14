#!/usr/bin/env bash
# Sync koreader-plugin/pilcrow.koplugin/ onto a USB-mounted Kobo.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)/koreader-plugin/pilcrow.koplugin"
DEST_ROOT="${KOBO_MOUNT:-/Volumes/KOBOeReader}"
DEST="$DEST_ROOT/.adds/koreader/plugins/pilcrow.koplugin"

if [ ! -d "$DEST_ROOT" ]; then
  echo "Kobo not mounted at $DEST_ROOT." >&2
  echo "Plug in the device, or set KOBO_MOUNT=/path/to/mount and re-run." >&2
  exit 1
fi

if [ ! -d "$DEST_ROOT/.adds/koreader" ]; then
  echo "KOReader not installed at $DEST_ROOT/.adds/koreader." >&2
  exit 1
fi

mkdir -p "$DEST"
rsync -av --delete "$SRC/" "$DEST/"
echo "Installed pilcrow.koplugin → $DEST"
