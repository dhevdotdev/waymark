#!/bin/bash
# Launches the packaged app on a vault, waits for its window, captures it, and quits.
# Usage: scripts/capture-native.sh <vault> show:<note>:<extra> <out.png> [light|dark]
# The app's own appearance is set; the system appearance is never changed.
set -euo pipefail
VAULT=$1; MODE=$2; OUT=$3; SCHEME=${4:-light}
APP="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/target/release/bundle/macos/Waymark.app/Contents/MacOS/waymark"
REPORT=$(mktemp)
WAYMARK_SELFTEST_STAY=1 WAYMARK_SELFTEST_OUT=$REPORT WAYMARK_SELFTEST_VAULT=$VAULT WAYMARK_SELFTEST_MODE="$MODE:$SCHEME" "$APP" >/dev/null 2>&1 &
PID=$!
for _ in $(seq 1 200); do
  [ -s "$REPORT" ] && break
  perl -e 'select(undef,undef,undef,0.1)'
done
osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is '"$PID"') to true' >/dev/null
perl -e 'select(undef,undef,undef,0.6)'
BOUNDS=$(osascript -e 'tell application "System Events" to tell (first process whose unix id is '"$PID"') to get {position, size} of window 1' | tr -d ' ')
IFS=, read -r X Y W H <<<"$BOUNDS"
screencapture -x -o -R "$X,$Y,$W,$H" "$OUT"
kill "$PID" 2>/dev/null || true
rm -f "$REPORT"
echo "$OUT ($W x $H)"
