#!/usr/bin/env bash
set -euo pipefail

# Usage: jdocmunch-watch-cap.sh [--check]
# `jdocmunch-mcp watch-install` writes the watcher's plist afresh, without the cap on its log. The
# cap binds every file the watcher writes, the index among them, so it stays far above the largest.
CAP=1073741824
PLIST="${JDOCMUNCH_WATCH_PLIST:-$HOME/Library/LaunchAgents/us.gravelle.jdocmunch-watch.plist}"

capped() {
  python3 -I - "$PLIST" "$CAP" <<'PY'
import plistlib, sys
with open(sys.argv[1], "rb") as f:
    job = plistlib.load(f)
sys.exit(0 if job.get("SoftResourceLimits", {}).get("FileSize") == int(sys.argv[2]) else 1)
PY
}

if [ "${1:-}" = --check ]; then
  [ ! -f "$PLIST" ] || capped && exit 0
  echo "The jDocMunch watcher's log has lost its 1 GB cap. Put it back: bash scripts/jdocmunch-watch-cap.sh"
  exit 1
fi

[ -f "$PLIST" ] || { echo "No $PLIST: run jdocmunch-mcp watch-install first." >&2; exit 1; }
capped && { echo "The cap is already in $PLIST. Nothing changed."; exit 0; }

python3 -I - "$PLIST" "$CAP" <<'PY'
import plistlib, sys
with open(sys.argv[1], "rb") as f:
    job = plistlib.load(f)
job.setdefault("SoftResourceLimits", {})["FileSize"] = int(sys.argv[2])
with open(sys.argv[1], "wb") as f:
    plistlib.dump(job, f)
PY

# launchd reads a plist only when the job loads, and bootout can return before the job is gone.
DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN" "$PLIST" 2>/dev/null || true
for wait in 1 2 3 4 5; do
  launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null \
    && { echo "Capped the watcher's files at 1 GB in $PLIST, and reloaded it."; exit 0; }
  sleep "$wait"
done
echo "The cap is written, but launchctl refused to load it: launchctl bootstrap $DOMAIN $PLIST" >&2
exit 1
